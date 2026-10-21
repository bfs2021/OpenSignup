import type { Db } from '@/db/client';
import { activityActor, recordActivityBestEffort } from '@/lib/activity';
import { checkDraft } from '@/lib/draft-checks';
import {
  buildUndo,
  draftInputOf,
  findNoticeFor,
  labelProblem,
  mergeRequestFor,
  planUndo,
  type DraftState,
  type FixableNotice,
  type UndoPlan,
} from '@/lib/draft-fixes';
import { fixDoneText } from '@/lib/draft-notices';
import { serviceError, type ServiceError } from '@/lib/errors';
import { parseInputSafe } from '@/lib/parse';
import { requireWorkspaceWrite, type Actor } from '@/lib/policy';
import { err, ok, type Result } from '@/lib/result';
import {
  DraftFixRequestSchema,
  DraftFixUndoSchema,
  type DraftFixKind,
  type DraftFixUndo,
} from '@/schemas/draft-fixes';
import type { SlotUnmergeInput } from '@/schemas/slots';
import { getSignupForOrganizer, updateSignup } from './signups';
import { addField, deleteField, updateField } from './slot-fields';
import { mergeSlots, unmergeSlots } from './slot-merge';
import { addSlotsBulk, deleteSlot, updateSlot } from './slots';

/**
 * The review page's one-tap fixes and their Undo (issue #503). Each fix and
 * each undo is made by the services the builder and the AI connector use, or,
 * for copies, by `mergeSlots` and `unmergeSlots`, so it is checked, locked and
 * logged as theirs are; this only decides which of them to call. Drafts only:
 * anything else is refused with `conflict` and `details.reason: 'not_draft'`.
 */

export interface AppliedDraftFix {
  kind: DraftFixKind;
  /** For Undo, which sends it back. */
  undo: DraftFixUndo;
  /** What the page says was done, next to Undo. */
  done: string;
}

function conflict(reason: 'not_draft' | 'stale' | 'changed', message: string): ServiceError {
  return serviceError('conflict', message, { details: { reason } });
}

/**
 * A refusal from `mergeSlots` or `unmergeSlots` in the words the page uses
 * for the others. Both check under their locks what the checks here read
 * without them, so a refusal means the signup changed in between: published
 * (its status), or, for a merge, a copy deleted, closed or no longer
 * accepted; for an undo, the kept slot deleted or its capacity changed. A
 * value an undo can't put back (a field deleted since) stays as it is.
 */
function fromMerge(error: ServiceError, step: 'fix' | 'undo'): ServiceError {
  if (error.code === 'conflict' && error.field === 'status') {
    return conflict('not_draft', error.message);
  }
  if (step === 'undo') {
    return error.code === 'conflict' ? conflict('changed', error.message) : error;
  }
  // Not a total too big for one slot, which no change could have caused.
  const changed =
    (error.code === 'conflict' && error.field !== 'capacity') || error.code === 'invalid_input';
  return changed ? conflict('stale', error.message) : error;
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

  const fixed = await fix(db, actor, signupId, found, label, state);
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
  before: DraftState,
): Promise<Result<{ notice: FixableNotice; unmerge?: SlotUnmergeInput }, ServiceError>> {
  switch (notice.kind) {
    case 'empty_field': {
      const r = await deleteField(db, actor, notice.fieldId);
      return r.ok ? ok({ notice }) : r;
    }
    case 'blank_slot': {
      // One at a time, each in its own transaction, as the builder deletes
      // them. A slot gone already is what the fix wanted. Anything else stops
      // it, and Undo covers the slots that did go.
      const removed: string[] = [];
      let refused: ServiceError | null = null;
      for (const id of notice.slotIds) {
        const r = await deleteSlot(db, actor, id, { force: false });
        if (r.ok) {
          removed.push(id);
        } else {
          refused = r.error;
          if (r.error.code !== 'not_found') break;
        }
      }
      // Every one gone already: another tab got there first.
      if (removed.length === 0) {
        return err(
          refused && refused.code !== 'not_found' ? refused : conflict('stale', 'no slot to remove'),
        );
      }
      return ok({ notice: { ...notice, slotIds: removed } });
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
      const r = await mergeSlots(db, actor, signupId, mergeRequestFor(notice, before));
      if (!r.ok) return err(fromMerge(r.error, 'fix'));
      return ok({ notice: { ...notice, capacity: r.value.slot.capacity }, unmerge: r.value.undo });
    }
  }
}

/**
 * Undoes a fix from the undo `applyDraftFix` returned, by the inverse
 * changes through the same services. Refused with `conflict` and
 * `details.reason: 'changed'` when the signup has changed since in a way the
 * undo would overwrite (`planUndo`). Writes `review.fix_undone` with the kind,
 * best effort, once it's done.
 */
export async function undoDraftFix(
  db: Db,
  actor: Actor,
  signupId: string,
  rawInput: unknown,
): Promise<Result<{ kind: DraftFixKind }, ServiceError>> {
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
    case 'blank_slot': {
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
      return r.ok ? ok(null) : err(fromMerge(r.error, 'undo'));
    }
  }
}
