import { describe, expect, it } from 'vitest';
import { checkDraft, type DraftField, type DraftSlot } from './draft-checks';
import {
  fixDoneText,
  noticeHeading,
  noticeText,
  noticeView,
  removeDayDoneText,
  setCapacityDoneText,
} from './draft-notices';

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

function views(fields: DraftField[], slots: DraftSlot[], groupByFieldRefs: string[] = []) {
  return checkDraft({ fields, slots, settings: { groupByFieldRefs } }).map((n) =>
    noticeView(n, { fields, slots }),
  );
}

describe('noticeView', () => {
  it('offers a button for an empty field, blank slots and repeated dates, naming the field', () => {
    const slots = [
      slot('a', { what: 'Setup', date: '2030-11-14' }),
      slot('b', { what: 'Till', date: '2030-11-14' }),
      slot('d', { what: 'Setup', date: '2030-11-15' }),
      slot('e', { what: 'Till', date: '2030-11-15' }),
      slot('c', {}),
    ];
    expect(views([what, date, helper], slots).map(({ key, fix }) => ({ key, fix }))).toEqual([
      {
        key: 'empty_field:f_name',
        fix: {
          type: 'button',
          label: 'Remove field',
          name: 'Remove field “Volunteer name”',
          request: { kind: 'empty_field', fieldId: 'f_name' },
        },
      },
      {
        key: 'blank_slot:c',
        fix: {
          type: 'button',
          label: 'Remove it',
          name: 'Remove it',
          request: { kind: 'blank_slot', slotIds: ['c'] },
        },
      },
      {
        key: 'ungrouped_dates:f_date',
        fix: {
          type: 'button',
          label: 'Group by “Date”',
          name: 'Group by “Date”',
          request: { kind: 'ungrouped_dates', fieldId: 'f_date' },
        },
      },
    ]);
  });

  it('says "them" for several blank slots', () => {
    const [blank] = views([what], [slot('a', { what: 'Setup' }), slot('b', {}), slot('c', {})]);
    expect(blank?.fix).toMatchObject({ label: 'Remove them' });
  });

  it('offers a box for a field’s name', () => {
    const untitled: DraftField = { id: 'f_u', ref: 'u', label: 'Untitled', fieldType: 'text' };
    const [view] = views([what, untitled], [slot('a', { what: 'Setup', u: 'x' })]);
    expect(view).toMatchObject({
      kind: 'unnamed_field',
      key: 'unnamed_field:f_u',
      fix: { type: 'rename', fieldId: 'f_u', name: 'New name for the field “Untitled”' },
    });
  });

  it('leaves the other kinds to the builder', () => {
    const shown = views(
      [what],
      [slot('a', { what: 'TBD' }), slot('b', { what: 'Setup' }), slot('d', { what: '9am' })],
    );
    expect(shown.map((v) => v.kind)).toEqual(['placeholder', 'time_in_text']);
    expect(shown.every((v) => v.fix === undefined)).toBe(true);
    expect(shown.map((v) => v.key)).toEqual(['placeholder:a', 'time_in_text:f_what']);
  });

  it('offers to merge copies, naming them by their values', () => {
    const [copies] = views(
      [what, date],
      [
        slot('a', { what: 'Setup', date: '2030-11-14' }),
        slot('b', { what: 'Setup', date: '2030-11-14' }),
        slot('c', { what: 'Till', date: '2030-11-15' }),
      ],
    );
    expect(copies).toMatchObject({
      kind: 'duplicate_slots',
      key: 'duplicate_slots:a',
      fix: {
        type: 'button',
        label: 'Merge into one slot',
        name: 'Merge into one slot: “Setup · Thu, Nov 14”',
        request: { kind: 'duplicate_slots', slotIds: ['a', 'b'] },
      },
    });
  });

  it('offers the same button for numbered rows, named by what they share', () => {
    const [numbered] = views(
      [what],
      [slot('a', { what: 'Helper 1' }), slot('b', { what: 'Helper 2' }), slot('c', { what: 'Setup' })],
    );
    expect(numbered?.text).toBe(
      '2 slots differ only by a number, like “Helper 1” and “Helper 2”. If they’re the same job, one slot for 2 people does it.',
    );
    expect(numbered?.fix).toEqual({
      type: 'button',
      label: 'Merge into one slot',
      name: 'Merge into one slot: “Helper”',
      request: { kind: 'duplicate_slots', slotIds: ['a', 'b'] },
    });
  });

  it('leaves more copies than one merge takes to the builder', () => {
    const many = Array.from({ length: 501 }, (_, i) => slot(`s${i}`, { what: 'Setup' }));
    const [copies] = views([what], many);
    expect(copies?.kind).toBe('duplicate_slots');
    expect(copies?.fix).toBeUndefined();
  });

  it('keeps the words noticeText gives', () => {
    const slots = [slot('a', { what: 'Setup' }), slot('b', {})];
    expect(views([what], slots).map((v) => v.text)).toEqual(texts([what], slots));
  });
});

describe('fixDoneText', () => {
  const ctx = { fields: [what, date], slots: [] };

  it('says what each fix did, by the field’s name', () => {
    expect(fixDoneText({ kind: 'empty_field', fieldId: 'f_date', ref: 'date' }, ctx)).toBe(
      'Removed “Date”.',
    );
    expect(fixDoneText({ kind: 'blank_slot', slotIds: ['a'] }, ctx)).toBe(
      'Removed the empty slot.',
    );
    expect(fixDoneText({ kind: 'blank_slot', slotIds: ['a', 'b', 'c'] }, ctx)).toBe(
      'Removed 3 empty slots.',
    );
    expect(fixDoneText({ kind: 'unnamed_field', fieldId: 'f_x' }, ctx, ' Shift ')).toBe(
      'Named the field “Shift”.',
    );
    expect(fixDoneText({ kind: 'ungrouped_dates', fieldId: 'f_date', ref: 'date' }, ctx)).toBe(
      'Grouped the slots by “Date”.',
    );
  });

  it('says how many slots a merge made into one, and its places', () => {
    const merge = (n: number, capacity: number | null, numbered = false) =>
      fixDoneText(
        {
          kind: 'duplicate_slots',
          slotIds: Array.from({ length: n }, (_, i) => `s${i}`),
          keepSlotId: 's0',
          capacity,
          values: { what: 'Helper' },
          numbered,
        },
        ctx,
      );
    expect(merge(3, 3)).toBe('Merged 3 slots into one for 3 people.');
    expect(merge(2, null)).toBe('Merged 2 slots into one with no limit.');
    expect(merge(4, 4, true)).toBe('Merged 4 slots into one for 4 people.');
  });

  it('never prints empty quotes for a field with no name', () => {
    const blank: DraftField = { id: 'f_b', ref: 'b', label: ' ', fieldType: 'date' };
    const noName = { fields: [blank], slots: [] };
    expect(fixDoneText({ kind: 'empty_field', fieldId: 'f_b', ref: 'b' }, noName)).toBe(
      'Removed the field with no name.',
    );
    expect(fixDoneText({ kind: 'ungrouped_dates', fieldId: 'f_b', ref: 'b' }, noName)).toBe(
      'Grouped the slots by date.',
    );
  });
});

describe('removeDayDoneText', () => {
  it('names the day as its header shows it, and how many slots went with it', () => {
    expect(removeDayDoneText('Sat, Apr 6', 4)).toBe('Removed Sat, Apr 6 and its 4 slots.');
    expect(removeDayDoneText('Sat, Apr 6', 1)).toBe('Removed Sat, Apr 6 and its slot.');
  });
});

describe('setCapacityDoneText', () => {
  it('says every slot was set, for one person or several', () => {
    expect(setCapacityDoneText(3, true)).toBe('Set every slot to 3 people.');
    expect(setCapacityDoneText(1, true)).toBe('Set every slot to 1 person.');
  });

  it('says so when every slot already took that number', () => {
    expect(setCapacityDoneText(3, false)).toBe('Every slot is already for 3 people.');
    expect(setCapacityDoneText(1, false)).toBe('Every slot is already for 1 person.');
  });
});
