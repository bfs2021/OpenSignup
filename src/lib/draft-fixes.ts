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

import type { DraftFixKind, DraftFixRequest, DraftFixUndo } from '@/schemas/draft-fixes';
import type { SlotUnmergeInput } from '@/schemas/slots';
import {
  LABEL_MAX_LENGTH,
  UNTITLED_FIELD_LABEL,
  type SlotFieldDefinition,
} from '@/schemas/slot-fields';
import {
  findBlankSlots,
  findDuplicateSlots,
  isEmpty,
  type DraftInput,
  type DraftNotice,
  type DraftNoticeOf,
  type DraftSlot,
} from './draft-checks';
import { resolveAnchorRef } from './reminder-fields';
import { groupByRef } from './signup-summary';

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

/** Whether two slots' values say the same thing, whatever order their keys are in. */
function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && JSON.stringify(a[k]) === JSON.stringify(b[k]))
  );
}

/**
 * What `mergeSlots` is asked for to merge a notice's copies: the slot it
 * keeps, every copy, and the values the kept slot ends up with when they
 * aren't the ones it has. Only numbered rows change them ("Helper 1" becomes
 * "Helper"); identical rows keep the kept slot's own.
 */
export function mergeRequestFor(
  notice: DraftNoticeOf<'duplicate_slots'>,
  before: DraftState,
): { keepSlotId: string; slotIds: string[]; values?: Record<string, unknown> } {
  const kept = before.slots.find((s) => s.id === notice.keepSlotId);
  const request = { keepSlotId: notice.keepSlotId, slotIds: notice.slotIds };
  return kept && sameValues(kept.values, notice.values)
    ? request
    : { ...request, values: notice.values };
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
    case 'blank_slot': {
      const ids = new Set(notice.slotIds);
      return {
        kind: 'blank_slot',
        slots: before.slots
          .filter((s) => ids.has(s.id))
          .map((s) => ({
            values: s.values,
            capacity: s.capacity,
            sortOrder: s.sortOrder,
            closed: s.status === 'closed',
          })),
      };
    }
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
  | {
      kind: 'blank_slot';
      rows: { values: Record<string, unknown>; capacity: number | null; sortOrder: number }[];
      /** The rows, by index, that were closed. */
      closed: number[];
    }
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
      // With the values of the fields that still exist, as deleting a field
      // leaves every slot; and only blank slots come back.
      const refs = new Set(now.fields.map((f) => f.ref));
      const rows = undo.slots.map((s) => ({
        values: Object.fromEntries(Object.entries(s.values).filter(([ref]) => refs.has(ref))),
        capacity: s.capacity,
        sortOrder: s.sortOrder,
      }));
      if (rows.some((r) => !Object.values(r.values).every(isEmpty))) return null;
      return {
        kind: 'blank_slot',
        rows,
        closed: undo.slots.flatMap((s, i) => (s.closed ? [i] : [])),
      };
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
    case 'duplicate_slots': {
      // `unmergeSlots` checks the first two again under its locks.
      const { keepSlotId, previous, restored } = undo.unmerge;
      const kept = now.slots.find((s) => s.id === keepSlotId);
      if (!kept) return null;
      const capacities = [previous.capacity, ...restored.map((r) => r.capacity)];
      const merged = capacities.some((c) => c === null)
        ? null
        : capacities.reduce<number>((sum, c) => sum + (c ?? 0), 0);
      if (kept.capacity !== merged) return null;
      // An undo that already ran (its answer lost, say) gave the kept slot
      // its own capacity back, so the check above refuses it again, except
      // when that was no limit: the total is no limit too. Then the copies
      // being back is what tells, and putting them back again would double
      // them.
      if (
        previous.capacity === null &&
        findDuplicateSlots(draftInputOf(now)).some((n) => n.slotIds.includes(keepSlotId))
      ) {
        return null;
      }
      return { kind: 'duplicate_slots', unmerge: undo.unmerge };
    }
  }
}
