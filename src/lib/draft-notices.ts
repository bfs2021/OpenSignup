/**
 * What the review page says about each problem `checkDraft` finds, in plain
 * words. The words name the organizer's own field labels and values in
 * quotes, so they read right whatever language those are in.
 */

import type { DraftCheckKind, DraftField, DraftNotice, DraftSlot } from './draft-checks';
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
