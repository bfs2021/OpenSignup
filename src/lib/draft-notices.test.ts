import { describe, expect, it } from 'vitest';
import { checkDraft, type DraftField, type DraftSlot } from './draft-checks';
import { noticeHeading, noticeText } from './draft-notices';

const what: DraftField = { id: 'f_what', ref: 'what', label: 'What', fieldType: 'text' };
const date: DraftField = { id: 'f_date', ref: 'date', label: 'Date', fieldType: 'date' };
const helper: DraftField = { id: 'f_name', ref: 'name', label: 'Volunteer name', fieldType: 'text' };

function slot(id: string, values: Record<string, unknown>, capacity: number | null = 1): DraftSlot {
  return { id, values, capacity };
}

function texts(fields: DraftField[], slots: DraftSlot[], groupByFieldRefs: string[] = []) {
  return checkDraft({ fields, slots, settings: { groupByFieldRefs } }).map(
    (n) => noticeText(n, { fields, slots }).text,
  );
}

describe('noticeText', () => {
  it('names the placeholder word the slots hold, and how many', () => {
    expect(
      texts(
        [what],
        [slot('a', { what: 'TBD: game 1' }), slot('b', { what: 'Snacks' }), slot('c', { what: 'tbd' })],
      ),
    ).toEqual([
      '2 slots still say “TBD”, so people would see that on the page. Fill them in, or remove the ones you don’t need.',
    ]);
    expect(texts([what], [slot('a', { what: 'Kickoff TBA' }), slot('b', { what: 'Snacks' })])).toEqual([
      'One slot still says “TBA”, so people would see that on the page. Fill it in, or remove the slot you don’t need.',
    ]);
  });

  it('explains an empty text field is not for the people signing up', () => {
    expect(texts([what, helper], [slot('a', { what: 'Setup' }), slot('b', { what: 'Till' })])).toEqual([
      '“Volunteer name” is empty on every slot, so it adds nothing to the page. If it was for people to fill in: they give their own name and email when they sign up.',
    ]);
  });

  it('says less about an empty date field', () => {
    expect(texts([what, date], [slot('a', { what: 'Setup' }), slot('b', { what: 'Till' })])).toEqual([
      '“Date” is empty on every slot, so it adds nothing to the page.',
    ]);
  });

  it('says blank slots show as Untitled slot', () => {
    expect(texts([what], [slot('a', { what: 'Setup' }), slot('b', {})])).toEqual([
      'One slot has nothing filled in. People would see it as “Untitled slot”.',
    ]);
  });

  it('describes copies by their values as the page shows them, and the slot that would replace them', () => {
    expect(
      texts(
        [what, date],
        [
          slot('a', { what: 'Setup', date: '2030-11-14' }),
          slot('b', { what: 'Setup', date: '2030-11-14' }),
          slot('c', { what: 'Setup', date: '2030-11-14' }),
          slot('d', { what: 'Till', date: '2030-11-15' }),
        ],
        ['date'],
      ),
    ).toEqual(['3 slots are the same: Setup · Thu, Nov 14. One slot for 3 people does the same job.']);
  });

  it('says a field is still Untitled, or has no name', () => {
    const untitled: DraftField = { id: 'f_u', ref: 'untitled', label: 'Untitled', fieldType: 'text' };
    expect(texts([what, untitled], [slot('a', { what: 'Setup', untitled: 'x' })])).toEqual([
      'A field is still called “Untitled”.',
    ]);
  });

  it('points out repeated dates on a page that isn’t grouped', () => {
    expect(
      texts(
        [what, date],
        [
          slot('a', { what: 'Setup', date: '2030-11-14' }),
          slot('b', { what: 'Till', date: '2030-11-14' }),
          slot('c', { what: 'Setup', date: '2030-11-15' }),
        ],
      ),
    ).toEqual([
      'Several slots share a “Date”, but the page isn’t grouped by it, so each date shows on every slot.',
    ]);
  });

  it('quotes a time typed into a text field', () => {
    expect(texts([what], [slot('a', { what: 'Morning 9am' }), slot('b', { what: 'Afternoon' })])).toEqual([
      'One slot has a time typed into “What”, like “Morning 9am”. A time field puts slots in order and times their reminders.',
    ]);
  });
});

describe('noticeText near misses', () => {
  it('says numbered rows differ only by a number, quoting two of them', () => {
    expect(
      texts([what], [slot('a', { what: 'Lane 1' }), slot('b', { what: 'Lane 2' }), slot('c', { what: 'Lane 3' })]),
    ).toEqual([
      '3 slots differ only by a number, like “Lane 1” and “Lane 2”. If they’re the same job, one slot for 3 people does it.',
    ]);
  });

  it('never prints empty quotes for a field with no name', () => {
    const blank: DraftField = { id: 'f_b', ref: 'b', label: ' ', fieldType: 'text' };
    expect(texts([what, blank], [slot('a', { what: 'Setup' }), slot('b', { what: 'Till' })])).toEqual([
      'A field with no name is empty on every slot, so it adds nothing to the page. If it was for people to fill in: they give their own name and email when they sign up.',
      'A field has no name yet.',
    ]);
    expect(texts([blank], [slot('a', { b: 'at 9am' }), slot('c', { b: 'Noon' })])).toEqual([
      'A field has no name yet.',
      'One slot has a time typed into a field with no name, like “at 9am”. A time field puts slots in order and times their reminders.',
    ]);
  });
});

describe('noticeHeading', () => {
  it('counts the things to fix', () => {
    expect(noticeHeading(1)).toBe('1 thing to fix before you publish');
    expect(noticeHeading(3)).toBe('3 things to fix before you publish');
  });
});
