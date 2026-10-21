/**
 * The review page's one-tap fixes (issue #503), as pure functions: which
 * notices have one, finding the notice a request is about on fresh data, and
 * how to undo each fix. Undo puts back what the fix changed through the same
 * services the fix used, never by restoring a copy of the signup, so it is
 * checked and logged like any other change.
 *
 * A draft never holds a sign-up (only an open signup takes one, and nothing
 * turns a signup back into a draft), so deleting a draft's slot and adding it
 * back loses only its id and its internal `ref`, neither of which anyone sees.
 */

import { createHash } from 'node:crypto';
import { serviceError, type ServiceError } from '@/lib/errors';
import type {
  DraftFixKind,
  DraftFixRequest,
  DraftFixUndo,
  RemoveDayRequest,
} from '@/schemas/draft-fixes';
import { SLOTS_PER_BULK_ADD, type SlotUnmergeInput } from '@/schemas/slots';
import {
  LABEL_MAX_LENGTH,
  UNTITLED_FIELD_LABEL,
  type SlotFieldDefinition,
} from '@/schemas/slot-fields';
import {
  findBlankSlots,
  isEmpty,
  type DraftInput,
  type DraftNotice,
  type DraftNoticeOf,
  type DraftSlot,
} from './draft-checks';
import { resolveAnchorRef } from './reminder-fields';
import { groupByRef, hasFilledSlot } from './signup-summary';
import { formatGroupLabel, groupKeyOf } from './slot-label';

/** A notice of one of the kinds with a one-tap fix (`DraftFixKind`). */
export type FixableNotice = DraftNoticeOf<DraftFixKind>;

/** A signup as the checks and the fixes read it. */
export interface DraftState {
  /** In the order the services return them. */
  fields: readonly SlotFieldDefinition[];
  /** In the order the page shows them. */
  slots: readonly (DraftSlot & { sortOrder: number; status: string })[];
  /** As stored; read leniently. */
  settings: unknown;
}

/** The signup's settings that the fixes read or write, as stored. */
function storedSettings(settings: unknown): {
  groupByFieldRefs: string[];
  reminderFromFieldRef: string | undefined;
} {
  const s = (typeof settings === 'object' && settings !== null ? settings : {}) as Record<
    string,
    unknown
  >;
  const groupBy = Array.isArray(s.groupByFieldRefs)
    ? s.groupByFieldRefs.filter((r): r is string => typeof r === 'string')
    : [];
  return {
    groupByFieldRefs: groupBy,
    reminderFromFieldRef:
      typeof s.reminderFromFieldRef === 'string' ? s.reminderFromFieldRef : undefined,
  };
}

/**
 * What `checkDraft` reads from a signup. The review page and the fixes both go
 * through this, so a fix finds exactly the notices the page showed.
 */
export function draftInputOf(signup: {
  fields: readonly SlotFieldDefinition[];
  slots: readonly DraftSlot[];
  settings: unknown;
}): DraftInput {
  // Read as the slot list reads it, so the checks see the grouping people do.
  const groupRef = groupByRef(signup.settings);
  return {
    fields: signup.fields,
    slots: signup.slots,
    settings: { groupByFieldRefs: groupRef ? [groupRef] : [] },
  };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

/**
 * The notice in `notices` that `request` is about: the same kind, naming the
 * same field, or exactly the same slots. Null when there is none, as when the
 * problem was fixed meanwhile, or the slots it covers changed: a fix is only
 * ever applied to the problem the organizer saw.
 */
export function findNoticeFor(
  notices: readonly DraftNotice[],
  request: DraftFixRequest,
): FixableNotice | null {
  for (const notice of notices) {
    if (
      (notice.kind === 'blank_slot' && request.kind === 'blank_slot') ||
      (notice.kind === 'duplicate_slots' && request.kind === 'duplicate_slots')
    ) {
      if (sameIds(notice.slotIds, request.slotIds)) return notice;
    } else if (
      (notice.kind === 'empty_field' && request.kind === 'empty_field') ||
      (notice.kind === 'unnamed_field' && request.kind === 'unnamed_field') ||
      (notice.kind === 'ungrouped_dates' && request.kind === 'ungrouped_dates')
    ) {
      if (notice.fieldId === request.fieldId) return notice;
    }
  }
  return null;
}

/**
 * The request a notice's button sends. A field with no name has a box for its
 * new name instead, so it has none here.
 */
export function fixRequestFor(notice: DraftNotice): DraftFixRequest | null {
  switch (notice.kind) {
    case 'empty_field':
      return { kind: 'empty_field', fieldId: notice.fieldId };
    case 'blank_slot':
      return { kind: 'blank_slot', slotIds: notice.slotIds };
    case 'ungrouped_dates':
      return { kind: 'ungrouped_dates', fieldId: notice.fieldId };
    case 'duplicate_slots':
      return { kind: 'duplicate_slots', slotIds: notice.slotIds };
    default:
      return null;
  }
}

/**
 * What `mergeSlots` is asked for to merge a notice's copies: the slot it
 * keeps, every copy, and for numbered rows the values without the number
 * ("Helper 1" becomes "Helper"). Identical rows keep the kept slot's own
 * values, which are the notice's.
 */
export function mergeRequestFor(notice: DraftNoticeOf<'duplicate_slots'>): {
  keepSlotId: string;
  slotIds: string[];
  values?: Record<string, unknown>;
} {
  const request = { keepSlotId: notice.keepSlotId, slotIds: notice.slotIds };
  return notice.numbered ? { ...request, values: notice.values } : request;
}

/**
 * A refusal from `mergeSlots`, `unmergeSlots` or `deleteDraftSlots`, as the
 * page words the others' (`details.reason`). Only what a change made since
 * causes reads as one: for a merge or a delete, a slot gone, closed, booked
 * or no longer a copy ('stale'); for an undo, the kept slot gone or changed
 * ('changed'); for any of them, a signup no longer a draft. Anything else
 * can't be waited out, so it isn't called a change, which would offer the
 * same button again: it becomes a plain `invalid_input`. The service's
 * `field` never passes on: it can be a slot field's ref, and a ref of
 * 'label' would read as the rename box's refusal.
 */
export function draftSlotsRefusal(error: ServiceError, step: 'fix' | 'undo'): ServiceError {
  const { code, message } = error;
  const because = (reason: 'not_draft' | 'stale' | 'changed') =>
    serviceError('conflict', message, { details: { reason } });
  if (code === 'conflict' && error.field === 'status') return because('not_draft');
  if (step === 'undo')
    return code === 'conflict' ? because('changed') : serviceError(code, message);
  // Every conflict but a total too big for one slot, which no change caused;
  // and a slot that is no longer there.
  const raced =
    (code === 'conflict' && error.field !== 'capacity') ||
    (code === 'invalid_input' && error.field === 'slotIds');
  if (raced) return because('stale');
  return serviceError(code === 'conflict' ? 'invalid_input' : code, message);
}

/**
 * What's wrong with a new name for a field, or null: blank, too long, or still
 * the builder's default, which the check would point out again.
 */
export function labelProblem(label: string): 'blank' | 'too_long' | 'untitled' | null {
  const trimmed = label.trim();
  if (trimmed === '') return 'blank';
  if (trimmed.length > LABEL_MAX_LENGTH) return 'too_long';
  if (trimmed.toLowerCase() === UNTITLED_FIELD_LABEL.toLowerCase()) return 'untitled';
  return null;
}

/**
 * How to undo `notice`'s fix, from the signup as it was just before it.
 * `label` is the new name, for a field with no name. A merge's undo is the one
 * `mergeSlots` returned, `unmerge`, passed on as it is.
 */
export function buildUndo(
  notice: FixableNotice,
  before: DraftState,
  label = '',
  unmerge?: SlotUnmergeInput,
): DraftFixUndo {
  const settings = storedSettings(before.settings);
  switch (notice.kind) {
    case 'empty_field': {
      const index = before.fields.findIndex((f) => f.id === notice.fieldId);
      const field = before.fields[index];
      if (!field) throw new Error('buildUndo: the notice names a field the signup lacks');
      return {
        kind: 'empty_field',
        field: {
          ref: field.ref,
          label: field.label,
          fieldType: field.fieldType,
          config: field.config,
        },
        beforeFieldId: before.fields[index + 1]?.id ?? null,
        // Only what deleting the field changes: the anchor moves off it, and
        // it leaves the grouping.
        settings: {
          ...(settings.reminderFromFieldRef === field.ref
            ? {
                reminderFromFieldRef: field.ref,
                anchorAfter: resolveAnchorRef(
                  settings,
                  before.fields.filter((f) => f.id !== field.id),
                ),
              }
            : {}),
          ...(settings.groupByFieldRefs.includes(field.ref)
            ? { groupByFieldRefs: settings.groupByFieldRefs }
            : {}),
        },
      };
    }
    case 'blank_slot':
      return { kind: 'blank_slot', slots: removedSlots(before, notice.slotIds) };
    case 'unnamed_field': {
      const field = before.fields.find((f) => f.id === notice.fieldId);
      if (!field) throw new Error('buildUndo: the notice names a field the signup lacks');
      return {
        kind: 'unnamed_field',
        fieldId: field.id,
        label: label.trim(),
        previous: field.label,
      };
    }
    case 'ungrouped_dates':
      return { kind: 'ungrouped_dates', ref: notice.ref, previous: settings.groupByFieldRefs };
    case 'duplicate_slots':
      if (!unmerge) throw new Error('buildUndo: a merge is undone with what mergeSlots returned');
      return { kind: 'duplicate_slots', unmerge };
  }
}

/** Slots to add back in one go, and which of them to close again. */
interface SlotsBack {
  rows: { values: Record<string, unknown>; capacity: number | null; sortOrder: number }[];
  /** The rows, by index, that were closed. */
  closed: number[];
}

/** What Undo asks of the services, worked out from the undo and the signup as it is now. */
export type UndoPlan =
  | {
      kind: 'empty_field';
      field: Extract<DraftFixUndo, { kind: 'empty_field' }>['field'];
      /** Undefined to put it last. */
      beforeFieldId: string | undefined;
      /** Settings to put back once the field is there again; null for none. */
      settings: { reminderFromFieldRef?: string; groupByFieldRefs?: string[] } | null;
    }
  | ({ kind: 'blank_slot' | 'remove_day' } & SlotsBack)
  | { kind: 'unnamed_field'; fieldId: string; label: string }
  | { kind: 'ungrouped_dates'; groupByFieldRefs: string[] }
  | { kind: 'duplicate_slots'; unmerge: SlotUnmergeInput };

/** A name that was blank goes back as the builder's default: a field needs one. */
export function restoredLabel(previous: string): string {
  return previous.trim() === '' ? UNTITLED_FIELD_LABEL : previous;
}

/**
 * How to undo a fix on the signup as it is `now`, or null when it changed
 * since in a way the undo would overwrite or can't put right: the field is
 * back or renamed again, the page grouped another way, a slot sent back that
 * isn't blank. Nothing here trusts the undo the page sent: the services check
 * what they're asked to write as they always do.
 */
export function planUndo(undo: DraftFixUndo, now: DraftState): UndoPlan | null {
  const settings = storedSettings(now.settings);
  switch (undo.kind) {
    case 'empty_field': {
      if (now.fields.some((f) => f.ref === undo.field.ref)) return null;
      // Deleting the field took it out of the grouping, which allows one
      // field: anything grouped since is a choice made after the fix.
      const regroup = undo.settings.groupByFieldRefs;
      if (regroup !== undefined && settings.groupByFieldRefs.length > 0) return null;
      // Likewise a reminder date picked since: the anchor isn't what deleting
      // the field left.
      if (
        undo.settings.reminderFromFieldRef !== undefined &&
        (settings.reminderFromFieldRef ?? null) !== (undo.settings.anchorAfter ?? null)
      ) {
        return null;
      }
      const next = undo.beforeFieldId;
      const restore = {
        ...(undo.settings.reminderFromFieldRef !== undefined
          ? { reminderFromFieldRef: undo.settings.reminderFromFieldRef }
          : {}),
        ...(regroup !== undefined ? { groupByFieldRefs: regroup } : {}),
      };
      return {
        kind: 'empty_field',
        field: { ...undo.field, label: restoredLabel(undo.field.label) },
        // The field it came before may have gone since; then it goes last.
        beforeFieldId: next !== null && now.fields.some((f) => f.id === next) ? next : undefined,
        settings: Object.keys(restore).length > 0 ? restore : null,
      };
    }
    case 'blank_slot': {
      // The fix removed every blank slot, so one there now means this undo
      // already ran (its answer lost, say) or one was added since: putting
      // them back again would double them.
      if (findBlankSlots(draftInputOf(now)).length > 0) return null;
      // Only blank slots come back.
      const back = slotsBack(undo.slots, now);
      if (back.rows.some((r) => !Object.values(r.values).every(isEmpty))) return null;
      return { kind: 'blank_slot', ...back };
    }
    case 'unnamed_field': {
      const field = now.fields.find((f) => f.id === undo.fieldId);
      if (!field || field.label !== undo.label) return null;
      return { kind: 'unnamed_field', fieldId: field.id, label: restoredLabel(undo.previous) };
    }
    case 'ungrouped_dates': {
      const [only, ...rest] = settings.groupByFieldRefs;
      if (only !== undo.ref || rest.length > 0) return null;
      return { kind: 'ungrouped_dates', groupByFieldRefs: undo.previous };
    }
    case 'duplicate_slots':
      // Whether the kept slot changed since (its values, places, position, an
      // undo already made) is `unmergeSlots`' to say, under its lock.
      if (!now.slots.some((s) => s.id === undo.unmerge.keepSlotId)) return null;
      return { kind: 'duplicate_slots', unmerge: undo.unmerge };
    case 'remove_day': {
      // The day's date has to mean what it did: the field still there, and
      // still a date.
      const field = now.fields.find((f) => f.ref === undo.ref);
      if (!field || field.fieldType !== 'date') return null;
      // A slot on that day now means this undo already ran (its answer lost,
      // say) or the day was added again since: putting the slots back would
      // double them, or mix them into a day made since.
      if (now.slots.some((s) => groupKeyOf(s.values[undo.ref]) === undo.value)) return null;
      return { kind: 'remove_day', ...slotsBack(undo.slots, now) };
    }
  }
}

/** Slots as they were before a fix or Remove day took them out, in list order. */
function removedSlots(
  before: DraftState,
  slotIds: readonly string[],
): Extract<DraftFixUndo, { kind: 'blank_slot' }>['slots'] {
  const ids = new Set(slotIds);
  return before.slots
    .filter((s) => ids.has(s.id))
    .map((s) => ({
      values: s.values,
      capacity: s.capacity,
      sortOrder: s.sortOrder,
      closed: s.status === 'closed',
    }));
}

/**
 * Removed slots to add back, with the values of the fields that still exist,
 * as deleting a field leaves every slot.
 */
function slotsBack(
  slots: Extract<DraftFixUndo, { kind: 'blank_slot' }>['slots'],
  now: DraftState,
): SlotsBack {
  const refs = new Set(now.fields.map((f) => f.ref));
  return {
    rows: slots.map((s) => ({
      values: Object.fromEntries(Object.entries(s.values).filter(([ref]) => refs.has(ref))),
      capacity: s.capacity,
      sortOrder: s.sortOrder,
    })),
    closed: slots.flatMap((s, i) => (s.closed ? [i] : [])),
  };
}

/**
 * A day the review page offers to remove (issue #504): one group of its slot
 * list, on a page grouped by a date field.
 */
export interface RemovableDay {
  /** The date field's ref. */
  ref: string;
  /** The group's value of it (its key in `groupSlots`). */
  value: string;
  /** The day as the group's header shows it: "Sat, Apr 6". */
  label: string;
  /** Every slot in the group, in list order, folded or not. Server-side only. */
  slotIds: string[];
  /** Stands for `slotIds` in what the page sends (`slotSetFingerprint`). */
  fingerprint: string;
}

/**
 * A short stand-in for a set of slots, whatever their order: how many, and a
 * hash of their ids. Remove day sends it in place of every id, and the server
 * works it out again from the slots as they are now; a slot added, moved or
 * deleted since changes it.
 */
export function slotSetFingerprint(slotIds: readonly string[]): string {
  const sorted = [...slotIds].sort();
  const hash = createHash('sha256').update(sorted.join('\n')).digest('base64url').slice(0, 16);
  return `${sorted.length}.${hash}`;
}

/**
 * The days the review page offers Remove day on, in list order. Only on a
 * page grouped by a date field (the only grouping the page reads), and only
 * for a group with a date: slots with none sit in a "(no date)" group, which
 * is no day. Never a day holding more slots than Undo adds back in one go;
 * and never one whose slots are the only ones with anything filled in, as the
 * draft would then open in the builder, and Undo would be lost with the page.
 */
export function removableDays(signup: {
  fields: readonly SlotFieldDefinition[];
  slots: readonly DraftSlot[];
  settings: unknown;
}): RemovableDay[] {
  const ref = groupByRef(signup.settings);
  const field = signup.fields.find((f) => f.ref === ref);
  if (!field || field.fieldType !== 'date') return [];
  const days = new Map<string, { ids: string[]; filled: number }>();
  let filled = 0;
  for (const slot of signup.slots) {
    const key = groupKeyOf(slot.values[field.ref]);
    const day = days.get(key) ?? { ids: [], filled: 0 };
    days.set(key, day);
    day.ids.push(slot.id);
    // As the review page reads it before it sends a draft to the builder.
    if (hasFilledSlot({ fields: signup.fields, slots: [slot] })) {
      day.filled++;
      filled++;
    }
  }
  const noDate = groupKeyOf(undefined);
  return [...days].flatMap(([value, day]) =>
    value !== noDate && day.ids.length <= SLOTS_PER_BULK_ADD && filled > day.filled
      ? [
          {
            ref: field.ref,
            value,
            label: formatGroupLabel(field, value),
            slotIds: day.ids,
            fingerprint: slotSetFingerprint(day.ids),
          },
        ]
      : [],
  );
}

/** What the review page's Remove day sends for `day`: no slot ids, only their fingerprint. */
export function removeDayRequest(day: RemovableDay): RemoveDayRequest {
  return { kind: 'remove_day', ref: day.ref, value: day.value, fingerprint: day.fingerprint };
}

/**
 * The day `request` is about, on the draft as it is now, or null: it has to
 * be one the page would offer, with exactly the same slots (the same
 * fingerprint), as a fix must find exactly the slots its notice named
 * (`findNoticeFor`). A slot moved into the day or out of it since, the page
 * grouped another way, or the day gone already, and nothing is removed.
 */
export function findDayFor(
  state: Pick<DraftState, 'fields' | 'slots' | 'settings'>,
  request: RemoveDayRequest,
): RemovableDay | null {
  return (
    removableDays(state).find(
      (d) =>
        d.ref === request.ref &&
        d.value === request.value &&
        d.fingerprint === request.fingerprint,
    ) ?? null
  );
}

/**
 * How to undo Remove day: the day's slots as they were, from the signup as it
 * was just before. They are deleted all together or not at all.
 */
export function removeDayUndo(day: RemovableDay, before: DraftState): DraftFixUndo {
  return {
    kind: 'remove_day',
    ref: day.ref,
    value: day.value,
    slots: removedSlots(before, day.slotIds),
  };
}
