/**
 * What the review page says about each problem `checkDraft` finds, in plain
 * words. The words name the organizer's own field labels and values in
 * quotes, so they read right whatever language those are in.
 */

import type { DraftFixRequest } from '@/schemas/draft-fixes';
import { MAX_MERGE_SLOTS, SLOTS_PER_BULK_ADD } from '@/schemas/slots';
import type { DraftCheckKind, DraftField, DraftNotice, DraftSlot } from './draft-checks';
import { fixRequestFor, type FixableNotice } from './draft-fixes';
import { people } from './signup-summary';
import { renderFieldValue } from './slot-label';

export interface NoticeContext {
  fields: readonly (DraftField & { config?: unknown })[];
  slots: readonly DraftSlot[];
}

export interface NoticeText {
  kind: DraftCheckKind;
  text: string;
}

function slotsPhrase(n: number, one: string, many: string): string {
  return n === 1 ? `One slot ${one}` : `${n} slots ${many}`;
}

function labelOf(ctx: NoticeContext, fieldId: string): string {
  return ctx.fields.find((f) => f.id === fieldId)?.label.trim() ?? '';
}

/** A field named in a sentence: “What”, or "a field with no name". */
function fieldName(label: string): string {
  return label ? `“${label}”` : 'a field with no name';
}

function forPeople(capacity: number | null): string {
  return capacity === null ? 'with no limit' : `for ${people(capacity)}`;
}

/** A slot's values as the public page shows them, joined: "Setup · Sat, Nov 14 · 9:00 AM". */
function slotSummary(ctx: NoticeContext, values: Record<string, unknown>): string {
  return ctx.fields
    .map((f) => renderFieldValue(f, values[f.ref]))
    .filter((v): v is string => v !== null)
    .join(' · ');
}

/** The notice's sentence, by kind. */
export function noticeText(notice: DraftNotice, ctx: NoticeContext): NoticeText {
  const { kind } = notice;
  switch (notice.kind) {
    case 'placeholder': {
      const n = notice.slotIds.length;
      return {
        kind,
        text: `${slotsPhrase(n, 'still says', 'still say')} “${notice.word}”, so people would see that on the page. Fill ${n === 1 ? 'it' : 'them'} in, or remove the ${n === 1 ? 'slot' : 'ones'} you don’t need.`,
      };
    }
    case 'empty_field': {
      const field = ctx.fields.find((f) => f.id === notice.fieldId);
      const label = field?.label.trim() ?? '';
      const name = label ? `“${label}”` : 'A field with no name';
      const base = `${name} is empty on every slot, so it adds nothing to the page.`;
      return {
        kind,
        text:
          field?.fieldType === 'text'
            ? `${base} If it was for people to fill in: they give their own name and email when they sign up.`
            : base,
      };
    }
    case 'blank_slot': {
      const n = notice.slotIds.length;
      return {
        kind,
        text: `${slotsPhrase(n, 'has', 'have')} nothing filled in. People would see ${n === 1 ? 'it' : 'them'} as “Untitled slot”.`,
      };
    }
    case 'duplicate_slots': {
      const n = notice.slotIds.length;
      const summary = slotSummary(ctx, notice.values);
      const one = `One slot ${forPeople(notice.capacity)}`;
      // Numbered rows ("Lane 1", "Lane 2") may be different things: say only
      // what's true, and leave the call to the organizer.
      if (notice.numbered) {
        const [a, b] = notice.slotIds
          .slice(0, 2)
          .map((id) => slotSummary(ctx, ctx.slots.find((s) => s.id === id)?.values ?? {}));
        return {
          kind,
          text: `${n} slots differ only by a number, like “${a}” and “${b}”. If they’re the same job, ${one.charAt(0).toLowerCase()}${one.slice(1)} does it.`,
        };
      }
      return {
        kind,
        text: `${n} slots are the same${summary ? `: ${summary}` : ''}. ${one} does the same job.`,
      };
    }
    case 'unnamed_field': {
      const label = labelOf(ctx, notice.fieldId);
      return {
        kind,
        text: label ? `A field is still called “${label}”.` : 'A field has no name yet.',
      };
    }
    case 'ungrouped_dates': {
      const label = labelOf(ctx, notice.fieldId);
      return {
        kind,
        text: `Several slots share a ${label ? `“${label}”` : 'date'}, but the page isn’t grouped by it, so each date shows on every slot.`,
      };
    }
    case 'time_in_text': {
      const n = notice.slotIds.length;
      const first = ctx.slots.find((s) => s.id === notice.slotIds[0]);
      const field = ctx.fields.find((f) => f.id === notice.fieldId);
      const example = field ? renderFieldValue(field, first?.values[field.ref]) : null;
      return {
        kind,
        text: `${slotsPhrase(n, 'has', 'have')} a time typed into ${fieldName(labelOf(ctx, notice.fieldId))}${example ? `, like “${example}”` : ''}. A time field puts slots in order and times their reminders.`,
      };
    }
  }
}

/** "2 things to fix before you publish". */
export function noticeHeading(count: number): string {
  return count === 1 ? '1 thing to fix before you publish' : `${count} things to fix before you publish`;
}

/**
 * A notice's one-tap fix, as the review page offers it: a button that sends
 * `request`, or a box for a field's new name. `name` is the button's or the
 * box's accessible name, which says which field when the words on screen
 * don't.
 */
type NoticeFix =
  | { type: 'button'; label: string; name: string; request: DraftFixRequest }
  | { type: 'rename'; fieldId: string; name: string };

/** A notice as the review page lists it: its words, a stable key, and its fix if it has one. */
export interface NoticeView extends NoticeText {
  key: string;
  fix?: NoticeFix;
}

/** The same key for the same problem from one render to the next. */
function noticeKey(notice: DraftNotice): string {
  switch (notice.kind) {
    case 'placeholder':
    case 'blank_slot':
      return `${notice.kind}:${notice.slotIds.join(',')}`;
    case 'duplicate_slots':
      return `${notice.kind}:${notice.keepSlotId}`;
    default:
      return `${notice.kind}:${notice.fieldId}`;
  }
}

function noticeFix(notice: DraftNotice, ctx: NoticeContext): NoticeFix | undefined {
  if (notice.kind === 'unnamed_field') {
    const label = labelOf(ctx, notice.fieldId);
    return {
      type: 'rename',
      fieldId: notice.fieldId,
      name: label ? `New name for the field “${label}”` : 'New name for the field',
    };
  }
  // Undo adds removed slots back in one go, so a fix never removes more; and
  // one merge takes in at most so many.
  if (notice.kind === 'blank_slot' && notice.slotIds.length > SLOTS_PER_BULK_ADD) return undefined;
  if (notice.kind === 'duplicate_slots' && notice.slotIds.length > MAX_MERGE_SLOTS) {
    return undefined;
  }
  const request = fixRequestFor(notice);
  if (!request) return undefined;
  switch (notice.kind) {
    case 'empty_field': {
      const label = labelOf(ctx, notice.fieldId);
      return {
        type: 'button',
        label: 'Remove field',
        name: label ? `Remove field “${label}”` : 'Remove field with no name',
        request,
      };
    }
    case 'blank_slot': {
      const label = notice.slotIds.length === 1 ? 'Remove it' : 'Remove them';
      return { type: 'button', label, name: label, request };
    }
    case 'ungrouped_dates': {
      const label = labelOf(ctx, notice.fieldId);
      const text = label ? `Group by “${label}”` : 'Group by date';
      return { type: 'button', label: text, name: text, request };
    }
    case 'duplicate_slots': {
      // Several sets of copies each have this button; the name says which.
      const label = 'Merge into one slot';
      const summary = slotSummary(ctx, notice.values);
      return { type: 'button', label, name: summary ? `${label}: “${summary}”` : label, request };
    }
    default:
      return undefined;
  }
}

/** Each notice's words, key and fix, for the review page. */
export function noticeView(notice: DraftNotice, ctx: NoticeContext): NoticeView {
  const fix = noticeFix(notice, ctx);
  return { ...noticeText(notice, ctx), key: noticeKey(notice), ...(fix ? { fix } : {}) };
}

/**
 * What the review page says once a fix is made, next to Undo, from the signup
 * as it was before. `label` is a field's new name.
 */
export function fixDoneText(notice: FixableNotice, ctx: NoticeContext, label = ''): string {
  switch (notice.kind) {
    case 'empty_field': {
      const name = labelOf(ctx, notice.fieldId);
      return name ? `Removed “${name}”.` : 'Removed the field with no name.';
    }
    case 'blank_slot': {
      const n = notice.slotIds.length;
      return n === 1 ? 'Removed the empty slot.' : `Removed ${n} empty slots.`;
    }
    case 'unnamed_field':
      return `Named the field “${label.trim()}”.`;
    case 'ungrouped_dates': {
      const name = labelOf(ctx, notice.fieldId);
      return `Grouped the slots by ${name ? `“${name}”` : 'date'}.`;
    }
    case 'duplicate_slots':
      return `Merged ${notice.slotIds.length} slots into one ${forPeople(notice.capacity)}.`;
  }
}

/**
 * What the review page says once Remove day is done, next to Undo: "Removed
 * Sat, Apr 6 and its 4 slots.", the day as its group's header shows it. The
 * slots go all together or not at all, so this is every one of them.
 */
export function removeDayDoneText(day: string, slots: number): string {
  return slots === 1 ? `Removed ${day} and its slot.` : `Removed ${day} and its ${slots} slots.`;
}
