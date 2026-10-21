import type { Db } from '@/db/client';
import { activityActor, recordActivityBestEffort } from '@/lib/activity';
import { checkDraft } from '@/lib/draft-checks';
import {
  buildUndo,
  capacitiesRefusal,
  draftInputOf,
  findCapacitySlots,
  findDayFor,
  findNoticeFor,
  labelProblem,
  draftSlotsRefusal,
  mergeRequestFor,
  planUndo,
  removeDayUndo,
  setCapacityUndo,
  type DraftState,
  type FixableNotice,
  type UndoPlan,
} from '@/lib/draft-fixes';
import { fixDoneText, removeDayDoneText, setCapacityDoneText } from '@/lib/draft-notices';
import { serviceError, type ServiceError } from '@/lib/errors';
import { parseInputSafe } from '@/lib/parse';
import { requireWorkspaceWrite, type Actor } from '@/lib/policy';
import { err, ok, type Result } from '@/lib/result';
import {
  DraftFixRequestSchema,
  DraftFixUndoSchema,
  RemoveDayRequestSchema,
  SetCapacityRequestSchema,
  type DraftFixUndo,
  type DraftUndoKind,
} from '@/schemas/draft-fixes';
import type { SlotUnmergeInput } from '@/schemas/slots';
import { getSignupForOrganizer, updateSignup } from './signups';
import { addField, deleteField, updateField } from './slot-fields';
import { mergeSlots, unmergeSlots } from './slot-merge';
import { addSlotsBulk, deleteDraftSlots, updateSlot, updateSlotCapacities } from './slots';

/**
 * The review page's one-tap fixes (issue #503), its Remove day and "People
 * for each slot" (issue #504), and their Undo. Each change and each undo is made by the services the
 * builder and the AI connector use, or, for copies, by `mergeSlots` and
 * `unmergeSlots`, so it is checked, locked and logged as theirs are; this only
 * decides which of them to call. Drafts only: anything else is refused with
 * `conflict` and `details.reason: 'not_draft'`.
 */

export interface AppliedDraftFix {
  kind: DraftUndoKind;
  /** For Undo, which sends it back. */
  undo: DraftFixUndo;
  /** What the page says was done, next to Undo. */
  done: string;
}

function conflict(reason: 'not_draft' | 'stale' | 'changed', message: string): ServiceError {
  return serviceError('conflict', message, { details: { reason } });
}

/** The signup, fresh, for someone who may change it, while it's a draft. */
async function loadDraft(
  db: Db,
  actor: Actor,
  signupId: string,
): Promise<Result<{ workspaceId: string | null; state: DraftState }, ServiceError>> {
  const loaded = await getSignupForOrganizer(db, actor, signupId);
  if (!loaded.ok) return loaded;
  const sig = loaded.value;
  // Before anything else, so a viewer is told they can't edit, whatever the
  // signup's state.
  requireWorkspaceWrite(actor, sig.workspaceId);
  if (sig.status !== 'draft') {
    return err(conflict('not_draft', 'only a draft is fixed from its review page'));
  }
  return ok({
    workspaceId: sig.workspaceId,
    state: {
      fields: sig.fields,
      slots: sig.slots.map((s) => ({
        id: s.id,
        values: (s.values as Record<string, unknown>) ?? {},
        capacity: s.capacity,
        status: s.status,
        sortOrder: s.sortOrder,
      })),
      settings: sig.settings,
    },
  });
}

/**
 * Fixes the problem `rawInput` names, if the draft still has exactly that
 * problem. The checks run again on the signup as it is now and the request
 * must match one of their notices by kind and ids; otherwise nothing changes
 * and the answer is `conflict` with `details.reason: 'stale'`. So a stale
 * page, or a change made in another tab or by an AI assistant since it
 * loaded, doesn't have a fix applied to something the organizer didn't see.
 * The check runs just before the service call, not inside its transaction: a
 * change landing in between is not caught.
 *
 * Writes `review.notice_accepted` with the kind once the fix is made: best
 * effort and outside the fix's own transactions, as it describes no change of
 * its own.
 */
export async function applyDraftFix(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<AppliedDraftFix, ServiceError>> {
  const input = parseInputSafe(DraftFixRequestSchema, rawInput);
  if (!input.ok) return input;
  const request = input.value;

  const loaded = await loadDraft(db, actor, signupId);
  if (!loaded.ok) return loaded;
  const { workspaceId, state } = loaded.value;

  const found = findNoticeFor(checkDraft(draftInputOf(state)), request);
  if (!found) return err(conflict('stale', 'the draft no longer has this problem'));

  let label = '';
  if (request.kind === 'unnamed_field') {
    const problem = labelProblem(request.label);
    if (problem) {
      return err(
        serviceError('invalid_input', 'the field needs a name', {
          field: 'label',
          details: { reason: problem },
        }),
      );
    }
    label = request.label.trim();
  }

  const fixed = await fix(db, actor, signupId, found, label);
  if (!fixed.ok) return fixed;
  const { notice, unmerge } = fixed.value;

  await recordActivityBestEffort(db, {
    signupId,
    workspaceId,
    actor: activityActor(actor),
    eventType: 'review.notice_accepted',
    payload: { kind: notice.kind },
  });
  return ok({
    kind: notice.kind,
    undo: buildUndo(notice, state, label, unmerge),
    done: fixDoneText(notice, { fields: state.fields, slots: state.slots }, label),
  });
}

/**
 * Makes the fix. Returns the notice as far as it was fixed, and for a merge
 * the undo `mergeSlots` gave back.
 */
async function fix(
  db: Db,
  actor: Actor,
  signupId: string,
  notice: FixableNotice,
  label: string,
): Promise<Result<{ notice: FixableNotice; unmerge?: SlotUnmergeInput }, ServiceError>> {
  switch (notice.kind) {
    case 'empty_field': {
      const r = await deleteField(db, actor, notice.fieldId);
      return r.ok ? ok({ notice }) : r;
    }
    case 'blank_slot': {
      // All or nothing, in one transaction, while the signup is a draft.
      const r = await deleteDraftSlots(db, actor, signupId, { slotIds: notice.slotIds });
      return r.ok ? ok({ notice }) : err(draftSlotsRefusal(r.error, 'fix'));
    }
    case 'unnamed_field': {
      const r = await updateField(db, actor, notice.fieldId, { label });
      return r.ok ? ok({ notice }) : r;
    }
    case 'ungrouped_dates': {
      const r = await updateSignup(db, actor, signupId, {
        settings: { groupByFieldRefs: [notice.ref] },
      });
      return r.ok ? ok({ notice }) : r;
    }
    case 'duplicate_slots': {
      // All or nothing, in one transaction, the total worked out from the
      // rows as locked.
      const r = await mergeSlots(db, actor, signupId, mergeRequestFor(notice));
      if (!r.ok) return err(draftSlotsRefusal(r.error, 'fix'));
      return ok({ notice: { ...notice, capacity: r.value.slot.capacity }, unmerge: r.value.undo });
    }
  }
}

/**
 * Remove day on a draft's review page (issue #504): deletes every slot of the
 * day `rawInput` names, one group of the slot list on a page grouped by a
 * date field, all together or none (`deleteDraftSlots`). The day is found
 * again on the signup as it is now and must be one the page offers with
 * exactly the slots it showed (`findDayFor`, by their fingerprint);
 * otherwise nothing changes and the answer is `conflict` with
 * `details.reason: 'stale'`, as for a fix: a slot moved into the day or out
 * of it, or added to it, by another tab or an AI assistant since the page
 * loaded. As there, that check runs just before the delete, not inside its
 * transaction, which checks again that each slot is still there and the
 * signup still a draft.
 *
 * Returns the same as a fix, so `undoDraftFix` is its Undo too. Writes
 * `review.slots_edited` with `{ kind: 'remove_day' }` once the slots are
 * gone: best effort and outside the delete's transaction, as it describes
 * no change of its own (the delete writes `slot.deleted`).
 */
export async function removeDraftDay(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<AppliedDraftFix, ServiceError>> {
  const input = parseInputSafe(RemoveDayRequestSchema, rawInput);
  if (!input.ok) return input;

  const loaded = await loadDraft(db, actor, signupId);
  if (!loaded.ok) return loaded;
  const { workspaceId, state } = loaded.value;

  const day = findDayFor(state, input.value);
  if (!day) return err(conflict('stale', 'the draft no longer has this day as the page showed it'));

  const removed = await deleteDraftSlots(db, actor, signupId, { slotIds: day.slotIds });
  if (!removed.ok) return err(draftSlotsRefusal(removed.error, 'fix'));

  await recordActivityBestEffort(db, {
    signupId,
    workspaceId,
    actor: activityActor(actor),
    eventType: 'review.slots_edited',
    payload: { kind: 'remove_day' },
  });
  return ok({
    kind: 'remove_day',
    undo: removeDayUndo(day, state),
    done: removeDayDoneText(day.label, day.slotIds.length),
  });
}

/**
 * "People for each slot" on a draft's review page (issue #504): every slot
 * to take the number of people `rawInput` names, in one transaction
 * (`updateSlotCapacities`, which leaves a slot that already takes it alone).
 * The slots must be exactly the ones the page showed, by their fingerprint
 * (`findCapacitySlots`); otherwise nothing changes and the answer is
 * `conflict` with `details.reason: 'stale'`, as for Remove day: a slot added
 * or deleted since, by another tab or an AI assistant. As there, that check
 * runs just before the change, not inside its transaction, which checks
 * again that each slot is still the signup's.
 *
 * Returns what Remove day returns, with no undo when every slot already took
 * that number: nothing was done. Otherwise writes `review.slots_edited` with
 * `{ kind: 'set_capacity' }`, best effort and outside the change's own
 * transaction, which writes `slot.updated`.
 */
export async function setDraftCapacity(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<Omit<AppliedDraftFix, 'undo'> & { undo: DraftFixUndo | null }, ServiceError>> {
  const input = parseInputSafe(SetCapacityRequestSchema, rawInput);
  if (!input.ok) return input;
  const { capacity } = input.value;

  const loaded = await loadDraft(db, actor, signupId);
  if (!loaded.ok) return loaded;
  const { workspaceId, state } = loaded.value;

  const slotIds = findCapacitySlots(state.slots, input.value);
  if (!slotIds) return err(conflict('stale', 'the draft no longer has the slots the page showed'));

  const set = await updateSlotCapacities(db, actor, signupId, {
    slots: slotIds.map((id) => ({ id, capacity })),
  });
  if (!set.ok) return err(capacitiesRefusal(set.error, 'fix'));
  const { previous } = set.value;
  if (previous.length === 0) {
    return ok({ kind: 'set_capacity', undo: null, done: setCapacityDoneText(capacity, false) });
  }

  await recordActivityBestEffort(db, {
    signupId,
    workspaceId,
    actor: activityActor(actor),
    eventType: 'review.slots_edited',
    payload: { kind: 'set_capacity' },
  });
  return ok({
    kind: 'set_capacity',
    undo: setCapacityUndo(capacity, previous),
    done: setCapacityDoneText(capacity, true),
  });
}

/**
 * Undoes a fix, a Remove day or "People for each slot", from the undo
 * `applyDraftFix`, `removeDraftDay` or `setDraftCapacity` returned, by the
 * inverse changes through the same services. Refused with `conflict` and
 * `details.reason: 'changed'` when the signup has changed since in a way the
 * undo would overwrite (`planUndo`). Writes `review.fix_undone` with the kind
 * (`remove_day` for a day, `set_capacity` for people each), best effort,
 * once it's done.
 */
export async function undoDraftFix(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<{ kind: DraftUndoKind }, ServiceError>> {
  const input = parseInputSafe(DraftFixUndoSchema, rawInput);
  if (!input.ok) return input;

  const loaded = await loadDraft(db, actor, signupId);
  if (!loaded.ok) return loaded;
  const { workspaceId, state } = loaded.value;

  const plan = planUndo(input.value, state);
  if (!plan) return err(conflict('changed', 'the signup changed since the fix'));
  const undone = await undo(db, actor, signupId, plan);
  if (!undone.ok) return undone;

  await recordActivityBestEffort(db, {
    signupId,
    workspaceId,
    actor: activityActor(actor),
    eventType: 'review.fix_undone',
    payload: { kind: plan.kind },
  });
  return ok({ kind: plan.kind });
}

async function undo(
  db: Db,
  actor: Actor,
  signupId: string,
  plan: UndoPlan,
): Promise<Result<null, ServiceError>> {
  switch (plan.kind) {
    case 'empty_field': {
      // The field first: `updateSignup` refuses an anchor that names a field
      // the signup doesn't have, or one that isn't a date.
      const added = await addField(db, actor, signupId, {
        ...plan.field,
        ...(plan.beforeFieldId !== undefined ? { beforeFieldId: plan.beforeFieldId } : {}),
      });
      if (!added.ok) return added;
      if (plan.settings) {
        const r = await updateSignup(db, actor, signupId, { settings: plan.settings });
        if (!r.ok) return r;
      }
      return ok(null);
    }
    case 'blank_slot':
    case 'remove_day': {
      const added = await addSlotsBulk(db, actor, signupId, { rows: plan.rows });
      if (!added.ok) return added;
      // A new slot is open; one that was closed is closed again.
      for (const i of plan.closed) {
        const slot = added.value[i];
        if (!slot) continue;
        const r = await updateSlot(db, actor, slot.id, { status: 'closed' });
        if (!r.ok) return r;
      }
      return ok(null);
    }
    case 'unnamed_field': {
      const r = await updateField(db, actor, plan.fieldId, { label: plan.label });
      return r.ok ? ok(null) : r;
    }
    case 'ungrouped_dates': {
      const r = await updateSignup(db, actor, signupId, {
        settings: { groupByFieldRefs: plan.groupByFieldRefs },
      });
      return r.ok ? ok(null) : r;
    }
    case 'duplicate_slots': {
      const r = await unmergeSlots(db, actor, signupId, plan.unmerge);
      return r.ok ? ok(null) : err(draftSlotsRefusal(r.error, 'undo'));
    }
    case 'set_capacity': {
      const r = await updateSlotCapacities(db, actor, signupId, { slots: plan.slots });
      return r.ok ? ok(null) : err(capacitiesRefusal(r.error, 'undo'));
    }
  }
}
