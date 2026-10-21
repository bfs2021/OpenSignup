/**
 * Problems in a draft signup that the code can prove, each carrying what its
 * one-tap fix needs (issue #503). A false fix is worse than none, so every
 * check is exact: when a case is ambiguous, a check says nothing.
 *
 * Pure functions over the signup's fields, slots and settings. Fields are
 * read in the order given (the services return them by `sortOrder`), slots in
 * list order, and only the values under the signup's own field refs count.
 */

import type { SignupSettings } from '@/schemas/signups';
import { UNTITLED_FIELD_LABEL, type SlotFieldDefinition } from '@/schemas/slot-fields';

/** Every kind of notice, in the order `checkDraft` returns them. */
export const DRAFT_CHECK_KINDS = [
  'placeholder',
  'empty_field',
  'blank_slot',
  'duplicate_slots',
  'unnamed_field',
  'ungrouped_dates',
  'time_in_text',
] as const;
export type DraftCheckKind = (typeof DRAFT_CHECK_KINDS)[number];

export type DraftField = Pick<SlotFieldDefinition, 'id' | 'ref' | 'label' | 'fieldType'>;

export interface DraftSlot {
  id: string;
  values: Record<string, unknown>;
  /** null = no limit. */
  capacity: number | null;
  /** 'open' when left out. A closed slot is never one of a group of copies. */
  status?: string;
}

export interface DraftInput {
  fields: readonly DraftField[];
  slots: readonly DraftSlot[];
  settings: Pick<SignupSettings, 'groupByFieldRefs'>;
}

export type DraftNotice =
  /** Slots still holding a TBD/TBC/TBA the organizer has to fill in; `word` is the first, in capitals. */
  | { kind: 'placeholder'; slotIds: string[]; word: string }
  /** A field no slot has a value for. Fix: delete the field. */
  | { kind: 'empty_field'; fieldId: string; ref: string }
  /** Slots with no value in any field. Fix: delete them. */
  | { kind: 'blank_slot'; slotIds: string[] }
  /**
   * Rows that are copies of one another. Fix: give `keepSlotId` these
   * `values` and `capacity` (the copies' total, null when any had no limit),
   * and delete the other `slotIds`. `numbered` rows ("Helper 1", "Helper 2")
   * differ by their number, which may or may not mean something, so the
   * page says so rather than calling them the same.
   */
  | {
      kind: 'duplicate_slots';
      slotIds: string[];
      keepSlotId: string;
      capacity: number | null;
      values: Record<string, unknown>;
      numbered: boolean;
    }
  /** A field with no name, or still the builder's default one. */
  | { kind: 'unnamed_field'; fieldId: string }
  /** Several slots share a date, but the page isn't grouped. Fix: group by this field. */
  | { kind: 'ungrouped_dates'; fieldId: string; ref: string }
  /** No time field, but this text field holds times of day. A notice only. */
  | { kind: 'time_in_text'; fieldId: string; slotIds: string[] };

export type DraftNoticeOf<K extends DraftCheckKind> = Extract<DraftNotice, { kind: K }>;

function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/** A value as compared between slots: empty is null, strings are trimmed. */
function normalize(value: unknown): unknown {
  if (isEmpty(value)) return null;
  return typeof value === 'string' ? value.trim() : value;
}

function isBlank(slot: DraftSlot, fields: readonly DraftField[]): boolean {
  return fields.every((f) => isEmpty(slot.values[f.ref]));
}

// Not inside another word, in any script: "ÉTBA" and "TBD1" are not placeholders.
const PLACEHOLDER = /(?<![\p{L}\p{N}_])(TBD|TBC|TBA)(?![\p{L}\p{N}_])/iu;

/** The first placeholder word in the slot's values, or null. */
function placeholderIn(slot: DraftSlot, fields: readonly DraftField[]): string | null {
  for (const f of fields) {
    const value = slot.values[f.ref];
    const match = typeof value === 'string' ? PLACEHOLDER.exec(value) : null;
    if (match) return match[1]!.toUpperCase();
  }
  return null;
}

function holdsPlaceholder(slot: DraftSlot, fields: readonly DraftField[]): boolean {
  return placeholderIn(slot, fields) !== null;
}

/** Slots with a string value containing TBD, TBC or TBA as a word, any case. */
export function findPlaceholders({ fields, slots }: DraftInput): DraftNoticeOf<'placeholder'>[] {
  const found = slots
    .map((s) => ({ id: s.id, word: placeholderIn(s, fields) }))
    .filter((s): s is { id: string; word: string } => s.word !== null);
  return found.length > 0
    ? [{ kind: 'placeholder', slotIds: found.map((s) => s.id), word: found[0]!.word }]
    : [];
}

/** Fields empty on every slot, when there is at least one slot. */
export function findEmptyFields({ fields, slots }: DraftInput): DraftNoticeOf<'empty_field'>[] {
  if (slots.length === 0) return [];
  return fields
    .filter((f) => slots.every((s) => isEmpty(s.values[f.ref])))
    .map((f) => ({ kind: 'empty_field', fieldId: f.id, ref: f.ref }));
}

/**
 * Slots with no value in any field, even when that is every slot. Without
 * fields no slot could hold a value, so a signup with none says nothing.
 */
export function findBlankSlots({ fields, slots }: DraftInput): DraftNoticeOf<'blank_slot'>[] {
  if (fields.length === 0) return [];
  const slotIds = slots.filter((s) => isBlank(s, fields)).map((s) => s.id);
  return slotIds.length > 0 ? [{ kind: 'blank_slot', slotIds }] : [];
}

/** "Helper 1", "Helper #2": a space or "#" before a trailing whole number. */
const NUMBERED = /^(.*?)(?:\s+#?|\s*#)(\d+)$/;

interface CopyGroup {
  members: DraftSlot[];
  values: Record<string, unknown>;
  numbered: boolean;
}

/** Groups of slots whose normalized values are identical in every field. */
function exactCopies(candidates: readonly DraftSlot[], fields: readonly DraftField[]): CopyGroup[] {
  const byKey = new Map<string, DraftSlot[]>();
  for (const slot of candidates) {
    const key = JSON.stringify(fields.map((f) => normalize(slot.values[f.ref])));
    const members = byKey.get(key) ?? [];
    members.push(slot);
    byKey.set(key, members);
  }
  return [...byKey.values()]
    .filter((members) => members.length >= 2)
    .map((members) => ({ members, values: { ...members[0]!.values }, numbered: false }));
}

/**
 * Groups of capacity-1 slots identical but for a trailing number on one text
 * field, numbered 1 to n ("Room 101" and "Room 102" are different rooms). A
 * slot that would fall in two groups (two numbered fields) leaves both out.
 */
function numberedCopies(
  candidates: readonly DraftSlot[],
  fields: readonly DraftField[],
): CopyGroup[] {
  const byKey = new Map<string, { ref: string; base: string; entries: [DraftSlot, number][] }>();
  for (const slot of candidates) {
    if (slot.capacity !== 1) continue;
    for (const field of fields) {
      if (field.fieldType !== 'text') continue;
      const value = normalize(slot.values[field.ref]);
      const match = typeof value === 'string' ? NUMBERED.exec(value) : null;
      if (!match) continue;
      const base = match[1]!.trim();
      if (base === '') continue;
      const rest = fields.map((f) => (f === field ? null : normalize(slot.values[f.ref])));
      const key = JSON.stringify([field.ref, base, rest]);
      const group = byKey.get(key) ?? { ref: field.ref, base, entries: [] };
      group.entries.push([slot, Number(match[2])]);
      byKey.set(key, group);
    }
  }

  const groups: CopyGroup[] = [];
  for (const { ref, base, entries } of byKey.values()) {
    if (entries.length < 2) continue;
    const numbers = new Set(entries.map(([, n]) => n));
    const countsFromOne = entries.every((_, i) => numbers.has(i + 1));
    if (!countsFromOne) continue;
    const members = entries.map(([slot]) => slot);
    groups.push({ members, values: { ...members[0]!.values, [ref]: base }, numbered: true });
  }

  const seen = new Map<string, number>();
  for (const { members } of groups) {
    for (const { id } of members) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return groups.filter(({ members }) => members.every(({ id }) => seen.get(id) === 1));
}

/**
 * Whether the group lacks a value in a field that some slot outside it has:
 * then the rows are unfinished slots, not copies.
 */
function missesOthersValues(
  members: readonly DraftSlot[],
  fields: readonly DraftField[],
  slots: readonly DraftSlot[],
): boolean {
  const ids = new Set(members.map((s) => s.id));
  return fields.some(
    (f) =>
      members.some((s) => isEmpty(s.values[f.ref])) &&
      slots.some((s) => !ids.has(s.id) && !isEmpty(s.values[f.ref])),
  );
}

/**
 * Rows that are copies: identical in every field (strings trimmed), or
 * capacity-1 rows numbered "Helper 1", "Helper 2"…. Rows holding a
 * placeholder, blank rows, closed rows, and rows missing a value other slots
 * have are never copies. One notice per group, ordered by the slot it keeps
 * (the group's first).
 */
export function findDuplicateSlots({
  fields,
  slots,
}: DraftInput): DraftNoticeOf<'duplicate_slots'>[] {
  const candidates = slots.filter(
    (s) => s.status !== 'closed' && !isBlank(s, fields) && !holdsPlaceholder(s, fields),
  );
  const exact = exactCopies(candidates, fields);
  const inExact = new Set(exact.flatMap(({ members }) => members.map((s) => s.id)));
  const numbered = numberedCopies(
    candidates.filter((s) => !inExact.has(s.id)),
    fields,
  );

  const position = new Map(slots.map((s, i) => [s.id, i]));
  return [...exact, ...numbered]
    .filter(({ members }) => !missesOthersValues(members, fields, slots))
    .sort((a, b) => position.get(a.members[0]!.id)! - position.get(b.members[0]!.id)!)
    .map(({ members, values, numbered }) => ({
      kind: 'duplicate_slots',
      slotIds: members.map((s) => s.id),
      keepSlotId: members[0]!.id,
      capacity: members.some((s) => s.capacity === null)
        ? null
        : members.reduce((sum, s) => sum + (s.capacity ?? 0), 0),
      values,
      numbered,
    }));
}

/** Fields with a blank name, or still called what the builder names a new field. */
export function findUnnamedFields({ fields }: DraftInput): DraftNoticeOf<'unnamed_field'>[] {
  const untitled = UNTITLED_FIELD_LABEL.toLowerCase();
  return fields
    .filter((f) => {
      const label = f.label.trim();
      return label === '' || label.toLowerCase() === untitled;
    })
    .map((f) => ({ kind: 'unnamed_field', fieldId: f.id }));
}

/**
 * The first date field with at least two distinct dates, at least half of
 * them on two or more slots, while the page is not grouped (no group field,
 * or one that no longer exists). With most dates on one slot each, grouping
 * would only make one-slot groups.
 */
export function findUngroupedDates({
  fields,
  slots,
  settings,
}: DraftInput): DraftNoticeOf<'ungrouped_dates'>[] {
  const groupRef = settings.groupByFieldRefs[0];
  if (groupRef !== undefined && fields.some((f) => f.ref === groupRef)) return [];
  for (const field of fields) {
    if (field.fieldType !== 'date') continue;
    const counts = new Map<string, number>();
    for (const slot of slots) {
      const value = slot.values[field.ref];
      if (isEmpty(value)) continue;
      const key = JSON.stringify(normalize(value));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const repeated = [...counts.values()].filter((n) => n >= 2).length;
    if (counts.size >= 2 && repeated * 2 >= counts.size) {
      return [{ kind: 'ungrouped_dates', fieldId: field.id, ref: field.ref }];
    }
  }
  return [];
}

// "9:00", "14:30", or an hour with am/pm: "9am", "9 a.m.", "9:30pm", "10.30am".
// Not after a digit, ":" or ".", so "11:30" is read whole and "1.5" is no time.
// A bare clock time needs its minutes on a five ("9:05", "14:30"), as a
// schedule's are: "John 3:16" and a 21:14 score are not times of day.
const CLOCK = String.raw`(?:[01]?\d|2[0-3]):[0-5][05](?!\p{N})`;
const MERIDIEM = String.raw`(?:0?[1-9]|1[0-2])(?:[:.][0-5]\d)?\s?[ap]\.?\s?m\.?(?![\p{L}\p{N}])`;
const TIME_OF_DAY = new RegExp(String.raw`(?<![\p{N}:.])(?:${CLOCK}|${MERIDIEM})`, 'iu');

/**
 * With no time field, the first text field that holds a time of day on at
 * least one slot, and those slots. Bare numbers and ranges ("Ages 8–12") are
 * not times.
 */
export function findTimeInText({ fields, slots }: DraftInput): DraftNoticeOf<'time_in_text'>[] {
  if (fields.some((f) => f.fieldType === 'time')) return [];
  for (const field of fields) {
    if (field.fieldType !== 'text') continue;
    const slotIds = slots
      .filter((s) => {
        const value = s.values[field.ref];
        return typeof value === 'string' && TIME_OF_DAY.test(value);
      })
      .map((s) => s.id);
    if (slotIds.length > 0) return [{ kind: 'time_in_text', fieldId: field.id, slotIds }];
  }
  return [];
}

const CHECKS: { [K in DraftCheckKind]: (input: DraftInput) => DraftNoticeOf<K>[] } = {
  placeholder: findPlaceholders,
  empty_field: findEmptyFields,
  blank_slot: findBlankSlots,
  duplicate_slots: findDuplicateSlots,
  unnamed_field: findUnnamedFields,
  ungrouped_dates: findUngroupedDates,
  time_in_text: findTimeInText,
};

/** Every check over the draft, its notices in `DRAFT_CHECK_KINDS` order. */
export function checkDraft(input: DraftInput): DraftNotice[] {
  return DRAFT_CHECK_KINDS.flatMap((kind): DraftNotice[] => CHECKS[kind](input));
}
