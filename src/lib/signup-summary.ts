/**
 * What the organizer's review page ("Check your signup, then share it") says
 * about a draft's slots before anyone shares it: a headline, the values every
 * slot shares, and how much of the list shows before "Show all".
 *
 * The slot list itself is the public page's, so the review matches what
 * participants will see: grouping, row titles and meta come from
 * src/app/s/[slug]/slot-format.ts, and every value here goes through the same
 * `renderFieldValue`, so the summary and the rows under it agree.
 *
 * The headline is in fixed words and never borrows a field label. A label is
 * whatever the organizer typed, in any language, and no rule pluralizes every
 * one of them correctly; "12 slots · 3 days" reads right whatever the fields
 * are called.
 */

import { resolveAnchorRef } from '@/lib/reminder-fields';
import { renderFieldValue } from '@/lib/slot-label';
import type { SlotFieldDefinition } from '@/schemas/slot-fields';

/** The parts of a field definition the summary reads. A `SlotFieldDefinition` fits. */
export type SummaryField = Pick<SlotFieldDefinition, 'ref' | 'label' | 'fieldType' | 'sortOrder'>;

interface SummarySlot {
  id: string;
  values: Record<string, unknown>;
  /** A whole number above 0, or null for no limit. */
  capacity: number | null;
}

export interface SignupSummaryInput {
  /** In the order the public page lists them, as the services return them. */
  fields: readonly SummaryField[];
  slots: readonly SummarySlot[];
  /**
   * The signup's settings as stored. Only `groupByFieldRefs` and
   * `reminderFromFieldRef` are read, and a missing or malformed value reads as
   * not set, so a bad row still gets a summary.
   */
  settings: unknown;
}

function readSettings(settings: unknown): {
  groupRef: string | null;
  reminderFromFieldRef: string | undefined;
} {
  const s = (typeof settings === 'object' && settings !== null ? settings : {}) as Record<
    string,
    unknown
  >;
  const groupBy: unknown = Array.isArray(s.groupByFieldRefs) ? s.groupByFieldRefs[0] : undefined;
  return {
    groupRef: typeof groupBy === 'string' ? groupBy : null,
    reminderFromFieldRef:
      typeof s.reminderFromFieldRef === 'string' ? s.reminderFromFieldRef : undefined,
  };
}

/** The field ref the signup groups its slots by, read as leniently as the rest. */
export function groupByRef(settings: unknown): string | null {
  return readSettings(settings).groupRef;
}

function isBlank(raw: unknown): boolean {
  return raw === undefined || raw === null || raw === '';
}

/** "1 person", "3 people". */
export function people(n: number): string {
  return n === 1 ? '1 person' : `${n} people`;
}

/**
 * What a slot row on the review page shows on its right: how many people the
 * slot takes. "1 person", "3 people", or "No limit". Organizer wording: the
 * public page counts spots left instead (`capacityLabel`).
 */
export function peopleLabel(capacity: number | null): string {
  return capacity === null ? 'No limit' : people(capacity);
}

/**
 * The card's headline: "12 slots · 3 days · 3 people each".
 *
 * - Slots: "1 slot", "N slots"; with none at all, the whole headline is
 *   "No slots yet".
 * - Days: the distinct non-empty values of the signup's date field, which is
 *   the one `reminderFromFieldRef` names, or else the first date field by
 *   sort order (`resolveAnchorRef`, the rule the services use). Left out when
 *   there is no date field or no slot has a date.
 * - People: "3 people each" when every slot takes the same number, "1 to 4
 *   people each" when they differ, "no limit on people" when none has a
 *   limit, and ", some with no limit" added when only some do.
 */
export function signupHeadline({ fields, slots, settings }: SignupSummaryInput): string {
  if (slots.length === 0) return 'No slots yet';
  const parts = [slots.length === 1 ? '1 slot' : `${slots.length} slots`];
  const days = countDays(fields, slots, readSettings(settings).reminderFromFieldRef);
  if (days > 0) parts.push(days === 1 ? '1 day' : `${days} days`);
  parts.push(capacityPhrase(slots));
  return parts.join(' · ');
}

function countDays(
  fields: readonly SummaryField[],
  slots: readonly SummarySlot[],
  reminderFromFieldRef: string | undefined,
): number {
  const ref = resolveAnchorRef({ reminderFromFieldRef }, fields);
  if (ref === null) return 0;
  const days = new Set<string>();
  for (const slot of slots) {
    const raw = slot.values[ref];
    if (!isBlank(raw)) days.add(String(raw));
  }
  return days.size;
}

function capacityPhrase(slots: readonly SummarySlot[]): string {
  let min = Infinity;
  let max = -Infinity;
  let unlimited = 0;
  for (const { capacity } of slots) {
    if (capacity === null) {
      unlimited++;
      continue;
    }
    min = Math.min(min, capacity);
    max = Math.max(max, capacity);
  }
  if (unlimited === slots.length) return 'no limit on people';
  const each = min === max ? `${people(min)} each` : `${min} to ${max} people each`;
  return unlimited > 0 ? `${each}, some with no limit` : each;
}

/** A value every slot has, said once above the list instead of on every row. */
export interface SharedValue {
  ref: string;
  /** The value as `renderFieldValue` renders it, as the rows would have shown it. */
  text: string;
}

/**
 * The fields, in field order, whose value renders the same, and not empty, on
 * every slot: "Same on every slot: 9:00 AM · Riverside Field". The page then
 * leaves these refs out of each row's meta (`buildMetaSegments`' `omitRefs`).
 *
 * Empty for fewer than two slots, where "every slot" says nothing. The group
 * field is left out, since its header already says the value. Values are
 * compared by their rendered text, so the number 3 and the string "3" match.
 *
 * The row title's own field can be shared too (every row "Snack duty"); it is
 * returned like any other, and the row keeps its title regardless.
 */
export function sharedValues({ fields, slots, settings }: SignupSummaryInput): SharedValue[] {
  if (slots.length < 2) return [];
  const { groupRef } = readSettings(settings);
  const out: SharedValue[] = [];
  for (const field of fields) {
    if (field.ref === groupRef) continue;
    const text = sharedText(field, slots);
    if (text !== null) out.push({ ref: field.ref, text });
  }
  return out;
}

function sharedText(field: SummaryField, slots: readonly SummarySlot[]): string | null {
  let shared: string | null = null;
  for (const slot of slots) {
    const text = renderFieldValue(field, slot.values[field.ref]);
    if (!text) return null;
    if (shared === null) shared = text;
    else if (text !== shared) return null;
  }
  return shared;
}

/**
 * How much of the slot list shows when the review page loads.
 *
 * `groups` holds one entry per input group, in the same order:
 * - `open`: whether the group starts expanded. Every group of an ungrouped
 *   list is open (it has no header to fold behind); of a grouped one, only
 *   the first, and the rest show as a one-line header with their count.
 * - `visible`: how many of the group's rows show before "Show all".
 * - `hidden`: the rest of its rows (`size - visible`).
 *
 * `hiddenCount` is every row not visible at first, `total` every row. The page
 * shows "Show all {total} slots" only when `hiddenCount > 0`.
 */
export interface FoldPlan {
  groups: { key: string; open: boolean; visible: number; hidden: number }[];
  hiddenCount: number;
  total: number;
}

/**
 * Folds the list to the first group, or to `limit` rows, whichever is less.
 *
 * Ungrouped (`grouped` false, the single group `groupSlots` makes): the first
 * `limit` rows show and the rest are hidden. Several groups passed as
 * ungrouped are read as one list continuing from group to group.
 *
 * Grouped: the first group is open and every other group closed. If the
 * first group has more than `limit` rows, its first `limit` show and the rest
 * are hidden. A short first group does not borrow rows from the next one: a
 * closed group's header with its count already says what is in it.
 */
export function foldPlan(
  groups: readonly { key: string; size: number }[],
  grouped: boolean,
  limit = 6,
): FoldPlan {
  let budget = Math.max(0, limit);
  let hiddenCount = 0;
  let total = 0;
  const plan = groups.map(({ key, size }, i) => {
    const open = !grouped || i === 0;
    const visible = open ? Math.min(size, budget) : 0;
    budget -= visible;
    hiddenCount += size - visible;
    total += size;
    return { key, open, visible, hidden: size - visible };
  });
  return { groups: plan, hiddenCount, total };
}

/**
 * Whether any slot has a value worth showing in any field. A draft without
 * one (the blank template's empty row, or a draft whose rows were all
 * cleared) needs the builder, not a page asking the organizer to check it.
 */
export function hasFilledSlot({
  fields,
  slots,
}: Pick<SignupSummaryInput, 'fields' | 'slots'>): boolean {
  // Whitespace counts as empty, as the draft checks read it.
  return slots.some((slot) =>
    fields.some((field) => !!renderFieldValue(field, slot.values[field.ref])?.trim()),
  );
}

/**
 * Which slots a reminder will go out for: every slot, only some, or none.
 * None when reminders are off; otherwise it depends on how many slots have a
 * date still ahead to time a reminder from.
 */
export type ReminderReach = 'all' | 'some' | 'none';

export function reminderReach(
  sendReminders: boolean,
  slots: readonly { slotAt: Date | null }[],
  now: number = Date.now(),
): ReminderReach {
  if (!sendReminders || slots.length === 0) return 'none';
  const ahead = slots.filter((s) => s.slotAt !== null && s.slotAt.getTime() > now).length;
  if (ahead === 0) return 'none';
  return ahead === slots.length ? 'all' : 'some';
}

/**
 * "What happens when someone signs up", in plain words, from the two settings
 * a new organizer is most likely to want to change, promising a reminder
 * only where one will go out. `before` says when ("the day before").
 */
export function whatHappensOnSignUp({
  requireEmail,
  reminders,
  before,
}: {
  requireEmail: boolean;
  reminders: ReminderReach;
  before: string;
}): string {
  if (requireEmail) {
    if (reminders === 'all') {
      return `They give their name and email, and get a confirmation email now and a reminder ${before} their slot.`;
    }
    if (reminders === 'some') {
      return `They give their name and email, and get a confirmation email now, and a reminder ${before} if their slot has a date.`;
    }
    return 'They give their name and email, and get a confirmation email. No reminder emails.';
  }
  if (reminders === 'all') {
    return `They give their name. Email is optional: people who add one get a confirmation, and a reminder ${before} their slot.`;
  }
  if (reminders === 'some') {
    return `They give their name. Email is optional: people who add one get a confirmation, and a reminder ${before} if their slot has a date.`;
  }
  return 'They give their name. Email is optional: people who add one get a confirmation. No reminder emails.';
}
