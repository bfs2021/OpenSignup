import { and, eq, sql, type Column } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { commitments } from '@/db/schema/commitments';
import { slots } from '@/db/schema/slots';
import { activityActor, recordActivity } from '@/lib/activity';
import { serviceError, type ServiceError } from '@/lib/errors';
import { parseInputSafe } from '@/lib/parse';
import { requireWorkspaceWrite, type Actor } from '@/lib/policy';
import { err, ok, type Result } from '@/lib/result';
import {
  SlotMergeInputSchema,
  type SlotUnmergeInput,
  SlotUnmergeInputSchema,
} from '@/schemas/slots';
import { inWorkspace, lockSignupForWrite, lockSlotsForSignup, readLiveSignup } from './locks';
import { extractSlotAt, listFieldsForSignup, validateSlotValues } from './slot-fields';
import { insertSlot } from './slots';

/**
 * Merging copies of a slot into one, and undoing it: the one-tap fix for
 * identical rows on a draft's review page (issue #503, `findDuplicateSlots`
 * in src/lib/draft-checks.ts). Drafts only. On a published signup a merge
 * would move people who have signed up from one slot to another.
 */

type SlotRow = typeof slots.$inferSelect;

interface ReminderSettingsLike {
  reminderFromFieldRef?: string | undefined;
  [k: string]: unknown;
}

// The top of the int `capacity` column. Each slot is under it, but a merged
// total need not be.
const MAX_CAPACITY = 2_147_483_647;

/** The slots' total capacity: null (no limit) when any of them has none. */
function totalCapacity(capacities: readonly (number | null)[]): number | null {
  let total = 0;
  for (const c of capacities) {
    if (c === null) return null;
    total += c;
  }
  return total;
}

/**
 * `column` is one of `ids`. The ids travel as one JSON parameter, as in
 * `writeSlotOrder`, rather than one placeholder each.
 */
function idIn(column: Column, ids: readonly string[]) {
  return sql`${column} in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
}

/**
 * The signup locked, then its slots in the shared order (src/services/locks.ts),
 * refused unless it is still a live draft. Everything a merge or its undo
 * checks is read under these locks: an add, edit, reorder or publish of this
 * signup waits for the transaction to end, and a slot delete or a sign-up
 * already holding one of its slots finishes first.
 */
async function lockDraft(
  tx: Tx,
  signupId: string,
  workspaceId: string | null,
  doing: 'merged' | 'unmerged',
): Promise<Result<{ settings: ReminderSettingsLike; slots: SlotRow[] }, ServiceError>> {
  // Undefined for a soft delete that committed while this waited, too.
  const signup = await lockSignupForWrite(tx, signupId, workspaceId);
  if (!signup) return err(serviceError('not_found', 'signup not found'));
  if (signup.status !== 'draft') {
    return err(
      serviceError(
        'conflict',
        `slots can only be ${doing} on a draft, and this signup is ${signup.status}: ` +
          'people may have signed up for them',
        { field: 'status', received: signup.status, expected: 'draft' },
      ),
    );
  }
  const locked = await lockSlotsForSignup(tx, signupId, workspaceId);
  return ok({ settings: (signup.settings as ReminderSettingsLike) ?? {}, slots: locked });
}

/**
 * Refuses when anyone, in any status, holds a commitment on these slots. A
 * draft never has any (only `commitToSlot` makes them, on an open signup),
 * but a merge deleting a slot would delete its commitments with it, and an
 * undo lowering a capacity could leave more people than places.
 */
async function refuseCommitments(
  tx: Tx,
  workspaceId: string | null,
  slotIds: readonly string[],
  field: 'slotIds' | 'keepSlotId',
): Promise<Result<void, ServiceError>> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(commitments)
    .where(
      and(inWorkspace(commitments.workspaceId, workspaceId), idIn(commitments.slotId, slotIds)),
    );
  const n = row?.n ?? 0;
  if (n === 0) return ok(undefined);
  return err(
    serviceError(
      'conflict',
      `${n} ${n === 1 ? 'sign-up is' : 'sign-ups are'} on these slots, cancelled ones included`,
      { field, details: { commitments: n } },
    ),
  );
}

/**
 * Merge copies of a slot into one, in one transaction: `keepSlotId` takes the
 * total capacity of every slot in `slotIds` (worked out from the rows as
 * locked, null when any has no limit) and, when `values` is sent, those
 * values and the slot_at they resolve to; the others are deleted. Writes one
 * `slot.merged` activity row.
 *
 * Returns the kept slot and `undo`, the input `unmergeSlots` takes to put
 * everything back: the kept slot's values and capacity before, and the
 * deleted slots in the order they were shown.
 */
export async function mergeSlots(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<{ slot: SlotRow; undo: SlotUnmergeInput }, ServiceError>> {
  const input = parseInputSafe(SlotMergeInputSchema, rawInput);
  if (!input.ok) return input;
  const { keepSlotId, slotIds, values } = input.value;

  const found = await readLiveSignup(db, signupId);
  if (!found) return err(serviceError('not_found', 'signup not found'));
  requireWorkspaceWrite(actor, found.workspaceId);
  const { workspaceId } = found;

  return db.transaction(async (tx) => {
    const draft = await lockDraft(tx, signupId, workspaceId, 'merged');
    if (!draft.ok) return draft;
    const { settings, slots: current } = draft.value;

    // Checked against the rows as locked, so a slot deleted in another tab
    // since the page was drawn is refused here rather than deleted twice.
    const byId = new Map(current.map((s) => [s.id, s]));
    const unknown = slotIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return err(
        serviceError('invalid_input', `slot ${unknown[0]} is not a slot of this signup`, {
          field: 'slotIds',
          received: unknown[0],
          details: { unknown },
          suggestion: 'reload the signup: a slot may have been deleted or merged since',
        }),
      );
    }
    const wanted = new Set(slotIds);
    const group = current.filter((s) => wanted.has(s.id));
    const closed = group.find((s) => s.status !== 'open');
    if (closed) {
      return err(
        serviceError('conflict', `slot ${closed.id} is closed, and only open slots are merged`, {
          field: 'slotIds',
          received: closed.id,
        }),
      );
    }
    const booked = await refuseCommitments(tx, workspaceId, slotIds, 'slotIds');
    if (!booked.ok) return booked;

    const capacity = totalCapacity(group.map((s) => s.capacity));
    if (capacity !== null && capacity > MAX_CAPACITY) {
      return err(
        serviceError('conflict', 'together these slots have more places than one slot can hold', {
          field: 'capacity',
          received: capacity,
        }),
      );
    }

    let slotAt: Date | null = null;
    if (values !== undefined) {
      // Read under the signup lock, as `updateSlot` does: a field change or
      // an anchor move has finished, so the values are checked against the
      // fields as it left them and slot_at comes from the anchor as it stands.
      const fields = await listFieldsForSignup(tx, signupId);
      const valid = validateSlotValues(fields, values);
      if (!valid.ok) return valid;
      slotAt = extractSlotAt(settings, fields, values);
    }

    const kept = byId.get(keepSlotId)!;
    const others = group.filter((s) => s.id !== keepSlotId);
    const [slot] = await tx
      .update(slots)
      .set({
        capacity,
        ...(values !== undefined ? { values, slotAt } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(slots.id, keepSlotId), inWorkspace(slots.workspaceId, workspaceId)))
      .returning();
    if (!slot) throw new Error('merge: the kept slot was not updated under its lock');
    const mergedSlotIds = others.map((s) => s.id);
    await tx
      .delete(slots)
      .where(
        and(
          eq(slots.signupId, signupId),
          inWorkspace(slots.workspaceId, workspaceId),
          idIn(slots.id, mergedSlotIds),
        ),
      );

    await recordActivity(tx, {
      signupId,
      workspaceId,
      actor: activityActor(actor),
      eventType: 'slot.merged',
      payload: { slotId: keepSlotId, mergedSlotIds, capacity },
    });

    return ok({
      slot,
      undo: {
        keepSlotId,
        previous: { values: kept.values as Record<string, unknown>, capacity: kept.capacity },
        restored: others.map((s) => ({
          values: s.values as Record<string, unknown>,
          capacity: s.capacity,
          sortOrder: s.sortOrder,
          // Every slot merged was open: a closed one is refused above.
          status: 'open' as const,
        })),
      },
    });
  });
}

/**
 * Undo `mergeSlots`, in one transaction: the kept slot gets back its values
 * and capacity, and the deleted slots are added again at their old place in
 * the order (new ids, so a link to one of the old ids stays broken). Refused
 * with `conflict` when the kept slot is gone or its capacity is no longer the
 * merged total: it has been changed since, and putting the old numbers back
 * would undo that change too. Writes one `slot.unmerged` activity row.
 */
export async function unmergeSlots(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<{ slot: SlotRow; restored: SlotRow[] }, ServiceError>> {
  const input = parseInputSafe(SlotUnmergeInputSchema, rawInput);
  if (!input.ok) return input;
  const { keepSlotId, previous, restored } = input.value;

  const found = await readLiveSignup(db, signupId);
  if (!found) return err(serviceError('not_found', 'signup not found'));
  requireWorkspaceWrite(actor, found.workspaceId);
  const { workspaceId } = found;

  return db.transaction(async (tx) => {
    const draft = await lockDraft(tx, signupId, workspaceId, 'unmerged');
    if (!draft.ok) return draft;
    const { settings, slots: current } = draft.value;

    const kept = current.find((s) => s.id === keepSlotId);
    if (!kept) {
      return err(
        serviceError(
          'conflict',
          'the merged slot has been deleted since, so the merge cannot be undone',
          {
            field: 'keepSlotId',
            received: keepSlotId,
          },
        ),
      );
    }
    const merged = totalCapacity([previous.capacity, ...restored.map((r) => r.capacity)]);
    if (kept.capacity !== merged) {
      return err(
        serviceError(
          'conflict',
          'the merged slot has been changed since, so the merge cannot be undone',
          {
            field: 'capacity',
            received: kept.capacity,
            expected: merged === null ? 'no limit' : String(merged),
          },
        ),
      );
    }
    const booked = await refuseCommitments(tx, workspaceId, [keepSlotId], 'keepSlotId');
    if (!booked.ok) return booked;

    // Checked against the fields as they are now: a field deleted since the
    // merge makes a value for it unknown, and the undo is refused.
    const fields = await listFieldsForSignup(tx, signupId);
    for (const { values } of [previous, ...restored]) {
      const valid = validateSlotValues(fields, values);
      if (!valid.ok) return valid;
    }

    const [slot] = await tx
      .update(slots)
      .set({
        values: previous.values,
        capacity: previous.capacity,
        slotAt: extractSlotAt(settings, fields, previous.values),
        updatedAt: new Date(),
      })
      .where(and(eq(slots.id, keepSlotId), inWorkspace(slots.workspaceId, workspaceId)))
      .returning();
    if (!slot) throw new Error('unmerge: the kept slot was not updated under its lock');

    const back: SlotRow[] = [];
    for (const row of restored) {
      back.push(
        await insertSlot(tx, {
          signupId,
          workspaceId,
          values: row.values,
          capacity: row.capacity,
          sortOrder: row.sortOrder,
          slotAt: extractSlotAt(settings, fields, row.values),
          status: row.status,
        }),
      );
    }

    await recordActivity(tx, {
      signupId,
      workspaceId,
      actor: activityActor(actor),
      eventType: 'slot.unmerged',
      payload: {
        slotId: keepSlotId,
        restoredSlotIds: back.map((s) => s.id),
        capacity: previous.capacity,
      },
    });
    return ok({ slot, restored: back });
  });
}
