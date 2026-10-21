/**
 * What the review page says about each problem `checkDraft` finds, in plain
 * words. The words name the organizer's own field labels and values in
 * quotes, so they read right whatever language those are in.
 */

import type { DraftCheckKind, DraftField, DraftNotice, DraftSlot } from './draft-checks';
import { renderFieldValue } from './slot-label';

export interface NoticeContext {
  fields: readonly (DraftField & { config?: unknown })[];
  slots: readonly DraftSlot[];
}

export interface NoticeText {
  kind: DraftCheckKind;
  text: string;
}

const PLACEHOLDER_WORD = /(?<![\p{L}\p{N}_])(TBD|TBC|TBA)(?![\p{L}\p{N}_])/iu;

function slotsPhrase(n: number, one: string, many: string): string {
  return n === 1 ? `One slot ${one}` : `${n} slots ${many}`;
}

function labelOf(ctx: NoticeContext, fieldId: string): string {
  return ctx.fields.find((f) => f.id === fieldId)?.label.trim() ?? '';
}

function people(capacity: number | null): string {
  if (capacity === null) return 'with no limit';
  return capacity === 1 ? 'for 1 person' : `for ${capacity} people`;
}

/** The first placeholder word in these slots, as written ("TBD", "tba"). */
function placeholderWord(ctx: NoticeContext, slotIds: readonly string[]): string {
  for (const id of slotIds) {
    const slot = ctx.slots.find((s) => s.id === id);
    for (const field of ctx.fields) {
      const value = slot?.values[field.ref];
      const match = typeof value === 'string' ? PLACEHOLDER_WORD.exec(value) : null;
      if (match) return match[1]!.toUpperCase();
    }
  }
  return 'TBD';
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
      const word = placeholderWord(ctx, notice.slotIds);
      return {
        kind,
        text: `${slotsPhrase(n, 'still says', 'still say')} “${word}”, so people would see that on the page. Fill ${n === 1 ? 'it' : 'them'} in, or remove the ${n === 1 ? 'slot' : 'ones'} you don’t need.`,
      };
    }
    case 'empty_field': {
      const field = ctx.fields.find((f) => f.id === notice.fieldId);
      const label = field?.label.trim() || 'A field';
      const base = `“${label}” is empty on every slot, so it adds nothing to the page.`;
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
      return {
        kind,
        text: `${n} slots are the same${summary ? `: ${summary}` : ''}. One slot ${people(notice.capacity)} does the same job.`,
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
      const label = labelOf(ctx, notice.fieldId) || 'date';
      return {
        kind,
        text: `Several slots share a “${label}”, but the page isn’t grouped by it, so each date shows on every slot.`,
      };
    }
    case 'time_in_text': {
      const label = labelOf(ctx, notice.fieldId);
      const first = ctx.slots.find((s) => s.id === notice.slotIds[0]);
      const field = ctx.fields.find((f) => f.id === notice.fieldId);
      const example = field ? renderFieldValue(field, first?.values[field.ref]) : null;
      return {
        kind,
        text: `Some slots have a time typed into “${label}”${example ? `, like “${example}”` : ''}. A time field puts slots in order and times their reminders.`,
      };
    }
  }
}

/** "2 things to fix before you publish". */
export function noticeHeading(count: number): string {
  return count === 1 ? '1 thing to fix before you publish' : `${count} things to fix before you publish`;
}
