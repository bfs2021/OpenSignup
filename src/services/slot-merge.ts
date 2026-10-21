import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { slots } from '@/db/schema/slots';
import { activityActor, recordActivity } from '@/lib/activity';
import { findDuplicateSlots } from '@/lib/draft-checks';
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
import { idIn, insertSlot, refuseCommitments } from './slots';

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

/** Whether two slots' values say the same thing, whatever order their keys are in. */
function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && JSON.stringify(a[k]) === JSON.stringify(b[k]))
  );
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

    // Still copies of each other, all of them and only them: the check the
    // review page ran (`findDuplicateSlots`), run again on the rows and fields
    // as locked, so a copy renamed or added since the page was drawn, or a set
    // that was never copies, is refused and nothing is deleted. The values
    // sent, for numbered rows, must be the ones the copies now share.
    const fields = await listFieldsForSignup(tx, signupId);
    const copies = findDuplicateSlots({
      fields,
      slots: current.map((s) => ({
        id: s.id,
        values: (s.values as Record<string, unknown>) ?? {},
        capacity: s.capacity,
        status: s.status,
      })),
      settings: { groupByFieldRefs: [] },
    }).find((n) => n.slotIds.length === wanted.size && n.slotIds.every((id) => wanted.has(id)));
    if (!copies) {
      return err(
        serviceError('conflict', 'these slots are no longer copies of each other', {
          field: 'slotIds',
          details: { reason: 'not_copies' },
          suggestion: 'reload the signup: a slot may have been changed or added since',
        }),
      );
    }
    if (values !== undefined && !sameValues(values, copies.values)) {
      return err(
        serviceError('conflict', 'these are not the values the copies share now', {
          field: 'values',
          details: { reason: 'not_copies', expected: copies.values },
        }),
      );
    }

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
      // The fields were read under the signup lock, as `updateSlot` reads
      // them: a field change or an anchor move has finished, so the values are
      // checked against the fields as it left them and slot_at comes from the
      // anchor as it stands.
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
        keptUpdatedAt: slot.updatedAt.toISOString(),
        previous: { values: kept.values as Record<string, unknown>, capacity: kept.capacity },
        // Every slot merged was open: a closed one is refused above.
        restored: others.map((s) => ({
          values: s.values as Record<string, unknown>,
          capacity: s.capacity,
          sortOrder: s.sortOrder,
        })),
      },
    });
  });
}

/**
 * Undo `mergeSlots`, in one transaction: the kept slot gets back its values
 * and capacity, and the deleted slots are added again at their old place in
 * the order (new ids, so a link to one of the old ids stays broken). Refused
 * with `conflict` on `keepSlotId` when the kept slot is gone, or has changed
 * since the merge wrote it: its `updatedAt` is no longer `keptUpdatedAt`.
 * Editing a slot, reordering it and this undo all move `updatedAt`, so a
 * rename, a new date, other places, a move, or an undo already made (its
 * answer lost, say, or sent twice at once) are each refused rather than
 * overwritten or made twice. Writes one `slot.unmerged` activity row.
 */
export async function unmergeSlots(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<{ slot: SlotRow; restored: SlotRow[] }, ServiceError>> {
  const input = parseInputSafe(SlotUnmergeInputSchema, rawInput);
  if (!input.ok) return input;
  const { keepSlotId, keptUpdatedAt, previous, restored } = input.value;

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
    // Read under the signup lock, which every slot edit and reorder takes, so
    // two undos at once take turns and the second sees the first's write.
    if (kept.updatedAt.toISOString() !== keptUpdatedAt) {
      return err(
        serviceError(
          'conflict',
          'the merged slot has changed since, so the merge cannot be undone',
          {
            field: 'keepSlotId',
            received: kept.updatedAt.toISOString(),
            expected: keptUpdatedAt,
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
        // Never the merge's own instant, or a second undo would pass the check
        // above: two writes can land in the same millisecond.
        updatedAt: new Date(Math.max(Date.now(), Date.parse(keptUpdatedAt) + 1)),
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
