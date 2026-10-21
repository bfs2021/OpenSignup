import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FieldType } from '@/schemas/slot-fields';
import {
  DRAFT_CHECK_KINDS,
  checkDraft,
  findBlankSlots,
  findDuplicateSlots,
  findEmptyFields,
  findPlaceholders,
  findTimeInText,
  findUngroupedDates,
  findUnnamedFields,
  type DraftCheckKind,
  type DraftField,
  type DraftInput,
  type DraftNotice,
  type DraftSlot,
} from './draft-checks';

function field(ref: string, fieldType: FieldType = 'text', label: string = ref): DraftField {
  return { id: `fld_${ref}`, ref, label, fieldType };
}

function slot(id: string, values: Record<string, unknown>, capacity: number | null = 1): DraftSlot {
  return { id, values, capacity };
}

function draft(
  fields: DraftField[],
  slots: DraftSlot[],
  groupByFieldRefs: string[] = [],
): DraftInput {
  return { fields, slots, settings: { groupByFieldRefs } };
}

const role = field('role', 'text', 'Role');
const date = field('date', 'date', 'Date');
const time = field('time', 'time', 'Time');

describe('DRAFT_CHECK_KINDS', () => {
  it('names every notice kind, and nothing else', () => {
    expectTypeOf<DraftNotice['kind']>().toEqualTypeOf<DraftCheckKind>();
    expect(DRAFT_CHECK_KINDS).toEqual([
      'placeholder',
      'empty_field',
      'blank_slot',
      'duplicate_slots',
      'unnamed_field',
      'ungrouped_dates',
      'time_in_text',
    ]);
  });
});

describe('findPlaceholders', () => {
  it('collects every slot holding TBD, TBC or TBA as a word, in list order', () => {
    const opponent = field('opponent');
    const input = draft(
      [role, opponent],
      [
        slot('s1', { role: 'TBD: game 1' }),
        slot('s2', { role: 'Game 2', opponent: 'vs TBD' }),
        slot('s3', { role: 'Snacks' }),
        slot('s4', { role: 'Venue tba' }),
        slot('s5', { role: 'Kickoff (TBC)' }),
      ],
    );
    expect(findPlaceholders(input)).toEqual([
      { kind: 'placeholder', slotIds: ['s1', 's2', 's4', 's5'], word: 'TBD' },
    ]);
  });

  it('leaves the letters alone inside another word', () => {
    const input = draft(
      [role],
      [
        slot('s1', { role: 'TBDX' }),
        slot('s2', { role: 'xTBD' }),
        slot('s3', { role: 'TBD1' }),
        slot('s4', { role: 'Tbacco' }),
        slot('s5', { role: 'ÉTBA' }),
      ],
    );
    expect(findPlaceholders(input)).toEqual([]);
  });

  it('reads enum values too, and ignores values that are not strings', () => {
    const status = field('status', 'enum');
    const count = field('count', 'number');
    const input = draft(
      [status, count],
      [slot('s1', { status: 'TBA' }), slot('s2', { status: 'Confirmed', count: 3 })],
    );
    expect(findPlaceholders(input)).toEqual([{ kind: 'placeholder', slotIds: ['s1'], word: 'TBA' }]);
  });

  it('only reads the signup’s own fields', () => {
    const input = draft([role], [slot('s1', { role: 'Setup', gone: 'TBD' })]);
    expect(findPlaceholders(input)).toEqual([]);
  });
});

describe('findEmptyFields', () => {
  it('names each field that no slot has a value for', () => {
    const notes = field('notes');
    const where = field('where');
    const input = draft(
      [role, notes, where],
      [
        slot('s1', { role: 'Setup', notes: '', where: null }),
        slot('s2', { role: 'Cleanup', notes: '   ' }),
      ],
    );
    expect(findEmptyFields(input)).toEqual([
      { kind: 'empty_field', fieldId: 'fld_notes', ref: 'notes' },
      { kind: 'empty_field', fieldId: 'fld_where', ref: 'where' },
    ]);
  });

  it('leaves a field alone when one slot has a value', () => {
    const notes = field('notes');
    const input = draft(
      [role, notes],
      [slot('s1', { role: 'Setup' }), slot('s2', { role: 'Cleanup', notes: 'Bring gloves' })],
    );
    expect(findEmptyFields(input)).toEqual([]);
  });

  it('counts 0 as a value', () => {
    const count = field('count', 'number');
    const input = draft([count], [slot('s1', { count: 0 })]);
    expect(findEmptyFields(input)).toEqual([]);
  });

  it('says nothing when there are no slots', () => {
    expect(findEmptyFields(draft([role], []))).toEqual([]);
  });
});

describe('findBlankSlots', () => {
  it('collects slots with no value in any field', () => {
    const input = draft(
      [role, date],
      [
        slot('s1', { role: 'Setup' }),
        slot('s2', {}),
        slot('s3', { role: '  ', date: null }),
        slot('s4', { date: '2026-11-07' }),
      ],
    );
    expect(findBlankSlots(input)).toEqual([{ kind: 'blank_slot', slotIds: ['s2', 's3'] }]);
  });

  it('still reports when every slot is blank', () => {
    const input = draft([role], [slot('s1', {}), slot('s2', { role: '' })]);
    expect(findBlankSlots(input)).toEqual([{ kind: 'blank_slot', slotIds: ['s1', 's2'] }]);
  });

  it('ignores values under refs that are not fields', () => {
    const input = draft([role], [slot('s1', { gone: 'Setup' })]);
    expect(findBlankSlots(input)).toEqual([{ kind: 'blank_slot', slotIds: ['s1'] }]);
  });

  it('says nothing when the signup has no fields, since no slot could have a value', () => {
    expect(findBlankSlots(draft([], [slot('s1', {}, 20)]))).toEqual([]);
  });

  it('says nothing when every slot has a value', () => {
    expect(findBlankSlots(draft([role], [slot('s1', { role: 'Setup' })]))).toEqual([]);
  });
});

describe('findDuplicateSlots', () => {
  it('groups identical rows, keeps the first and adds up capacity', () => {
    const input = draft(
      [role, date],
      [
        slot('s1', { role: 'Setup', date: '2026-11-07' }, 2),
        slot('s2', { role: 'Cleanup', date: '2026-11-07' }, 1),
        slot('s3', { role: 'Setup', date: '2026-11-07' }, 3),
      ],
    );
    expect(findDuplicateSlots(input)).toEqual([
      {
        kind: 'duplicate_slots',
        slotIds: ['s1', 's3'],
        keepSlotId: 's1',
        capacity: 5,
        values: { role: 'Setup', date: '2026-11-07' },
        numbered: false,
      },
    ]);
  });

  it('trims strings before comparing', () => {
    const input = draft([role], [slot('s1', { role: 'Setup' }), slot('s2', { role: ' Setup  ' })]);
    expect(findDuplicateSlots(input)).toEqual([
      {
        kind: 'duplicate_slots',
        slotIds: ['s1', 's2'],
        keepSlotId: 's1',
        capacity: 2,
        values: { role: 'Setup' },
        numbered: false,
      },
    ]);
  });

  it('compares raw values: a number is not the same as its text, nor case-folded text', () => {
    const count = field('count', 'number');
    const input = draft(
      [role, count],
      [
        slot('s1', { role: 'Setup', count: 5 }),
        slot('s2', { role: 'Setup', count: '5' }),
        slot('s3', { role: 'setup', count: 5 }),
      ],
    );
    expect(findDuplicateSlots(input)).toEqual([]);
  });

  it('reports two separate groups, in the order their kept slots appear', () => {
    const input = draft(
      [role],
      [
        slot('s1', { role: 'Cleanup' }),
        slot('s2', { role: 'Setup' }),
        slot('s3', { role: 'Setup' }),
        slot('s4', { role: 'Cleanup' }),
        slot('s5', { role: 'Snacks' }),
      ],
    );
    expect(findDuplicateSlots(input)).toEqual([
      {
        kind: 'duplicate_slots',
        slotIds: ['s1', 's4'],
        keepSlotId: 's1',
        capacity: 2,
        values: { role: 'Cleanup' },
        numbered: false,
      },
      {
        kind: 'duplicate_slots',
        slotIds: ['s2', 's3'],
        keepSlotId: 's2',
        capacity: 2,
        values: { role: 'Setup' },
        numbered: false,
      },
    ]);
  });

  it('gives a null capacity when any copy has no limit', () => {
    const input = draft(
      [role],
      [slot('s1', { role: 'Setup' }, 4), slot('s2', { role: 'Setup' }, null)],
    );
    expect(findDuplicateSlots(input)).toEqual([
      {
        kind: 'duplicate_slots',
        slotIds: ['s1', 's2'],
        keepSlotId: 's1',
        capacity: null,
        values: { role: 'Setup' },
        numbered: false,
      },
    ]);
  });

  it('never groups rows that hold a placeholder', () => {
    const input = draft(
      [role],
      [slot('s1', { role: 'TBD' }), slot('s2', { role: 'TBD' }), slot('s3', { role: 'TBD' })],
    );
    expect(findDuplicateSlots(input)).toEqual([]);
  });

  it('never groups identical rows missing a value that other slots have', () => {
    // Three rows with no time while the others have one are unfinished slots.
    const input = draft(
      [role, time],
      [
        slot('s1', { role: 'Setup', time: '09:00' }),
        slot('s2', { role: 'Cleanup', time: '15:00' }),
        slot('s3', { role: 'Shift' }),
        slot('s4', { role: 'Shift' }),
        slot('s5', { role: 'Shift', time: '' }),
      ],
    );
    expect(findDuplicateSlots(input)).toEqual([]);
  });

  it('groups identical rows when the field they lack is empty on every slot', () => {
    const notes = field('notes');
    const input = draft(
      [role, notes],
      [slot('s1', { role: 'Setup' }), slot('s2', { role: 'Setup', notes: '' })],
    );
    expect(findDuplicateSlots(input)).toEqual([
      {
        kind: 'duplicate_slots',
        slotIds: ['s1', 's2'],
        keepSlotId: 's1',
        capacity: 2,
        values: { role: 'Setup' },
        numbered: false,
      },
    ]);
  });

  it('never calls blank slots copies', () => {
    const input = draft([role], [slot('s1', {}), slot('s2', { role: '' }), slot('s3', {})]);
    expect(findDuplicateSlots(input)).toEqual([]);
  });

  describe('numbered copies', () => {
    it('groups "Helper 1", "Helper 2", "Helper #3" with capacity 1 and drops the number', () => {
      const input = draft(
        [role, date],
        [
          slot('s1', { role: 'Helper 1', date: '2026-11-07' }),
          slot('s2', { role: 'Snacks', date: '2026-11-07' }),
          slot('s3', { role: 'Helper 2', date: '2026-11-07' }),
          slot('s4', { role: 'Helper #3', date: '2026-11-07' }),
        ],
      );
      expect(findDuplicateSlots(input)).toEqual([
        {
          kind: 'duplicate_slots',
          slotIds: ['s1', 's3', 's4'],
          keepSlotId: 's1',
          capacity: 3,
          values: { role: 'Helper', date: '2026-11-07' },
          numbered: true,
        },
      ]);
    });

    it('leaves them alone when a member has capacity other than 1', () => {
      const input = draft(
        [role],
        [slot('s1', { role: 'Helper 1' }, 2), slot('s2', { role: 'Helper 2' }, 2)],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('leaves them alone when a member has no limit', () => {
      const input = draft(
        [role],
        [slot('s1', { role: 'Helper 1' }), slot('s2', { role: 'Helper 2' }, null)],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('leaves numbered placeholders to the placeholder check', () => {
      const input = draft(
        [role],
        [
          slot('s1', { role: 'TBD: game 1' }),
          slot('s2', { role: 'TBD: game 2' }),
          slot('s3', { role: 'TBD: game 3' }),
        ],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
      expect(checkDraft(input)).toEqual([
        { kind: 'placeholder', slotIds: ['s1', 's2', 's3'], word: 'TBD' },
      ]);
    });

    it('leaves "Game 1" and "Game 2" alone on different dates', () => {
      const input = draft(
        [role, date],
        [
          slot('s1', { role: 'Game 1', date: '2026-11-07' }),
          slot('s2', { role: 'Game 2', date: '2026-11-14' }),
        ],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('only strips a trailing number from a text field', () => {
      const station = field('station', 'enum');
      const count = field('count', 'number');
      const input = draft(
        [station, count],
        [
          slot('s1', { station: 'Booth 1', count: 1 }),
          slot('s2', { station: 'Booth 2', count: 2 }),
        ],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('needs a space or # before the number', () => {
      const input = draft(
        [role],
        [slot('s1', { role: 'Helper1' }), slot('s2', { role: 'Helper2' })],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('needs the numbers to count from 1, so "Room 101" and "Room 102" are different rooms', () => {
      const input = draft(
        [role],
        [slot('s1', { role: 'Room 101' }), slot('s2', { role: 'Room 102' })],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('needs every other field to match', () => {
      const where = field('where');
      const input = draft(
        [role, where],
        [
          slot('s1', { role: 'Helper 1', where: 'Gym' }),
          slot('s2', { role: 'Helper 2', where: 'Library' }),
        ],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('applies the missing-value rule to numbered rows too', () => {
      const input = draft(
        [role, time],
        [
          slot('s1', { role: 'Setup', time: '08:00' }),
          slot('s2', { role: 'Helper 1' }),
          slot('s3', { role: 'Helper 2' }),
        ],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });

    it('stays silent when a row could belong to two numbered groups', () => {
      const station = field('station');
      const input = draft(
        [role, station],
        [
          slot('s1', { role: 'Helper 1', station: 'Booth 1' }),
          slot('s2', { role: 'Helper 2', station: 'Booth 1' }),
          slot('s3', { role: 'Helper 1', station: 'Booth 2' }),
        ],
      );
      expect(findDuplicateSlots(input)).toEqual([]);
    });
  });
});

describe('findUnnamedFields', () => {
  it('names fields with an empty label or the builder’s default name', () => {
    const input = draft(
      [
        field('a', 'text', ''),
        field('b', 'text', '   '),
        field('untitled', 'text', 'Untitled'),
        field('untitled-2', 'date', ' untitled '),
        role,
      ],
      [],
    );
    expect(findUnnamedFields(input)).toEqual([
      { kind: 'unnamed_field', fieldId: 'fld_a' },
      { kind: 'unnamed_field', fieldId: 'fld_b' },
      { kind: 'unnamed_field', fieldId: 'fld_untitled' },
      { kind: 'unnamed_field', fieldId: 'fld_untitled-2' },
    ]);
  });

  it('leaves real names alone, even ones that start with the default', () => {
    const input = draft(
      [
        field('a', 'text', 'Untitled 2'),
        field('b', 'text', 'Untitled song'),
        field('c', 'text', 'New field'),
      ],
      [],
    );
    expect(findUnnamedFields(input)).toEqual([]);
  });
});

describe('findUngroupedDates', () => {
  const repeated = [
    slot('s1', { role: 'Setup', date: '2026-11-07' }),
    slot('s2', { role: 'Cleanup', date: '2026-11-07' }),
    slot('s3', { role: 'Setup', date: '2026-11-14' }),
  ];

  it('suggests grouping by a date that repeats across several dates', () => {
    expect(findUngroupedDates(draft([role, date], repeated))).toEqual([
      { kind: 'ungrouped_dates', fieldId: 'fld_date', ref: 'date' },
    ]);
  });

  it('treats grouping by a field that no longer exists as ungrouped', () => {
    expect(findUngroupedDates(draft([role, date], repeated, ['gone']))).toEqual([
      { kind: 'ungrouped_dates', fieldId: 'fld_date', ref: 'date' },
    ]);
  });

  it('picks the first date field that qualifies', () => {
    const start = field('start', 'date');
    const input = draft(
      [start, date],
      [
        slot('s1', { start: '2026-11-01', date: '2026-11-07' }),
        slot('s2', { start: '2026-11-02', date: '2026-11-07' }),
        slot('s3', { start: '2026-11-03', date: '2026-11-14' }),
      ],
    );
    expect(findUngroupedDates(input)).toEqual([
      { kind: 'ungrouped_dates', fieldId: 'fld_date', ref: 'date' },
    ]);
  });

  it('says nothing when the page is already grouped', () => {
    expect(findUngroupedDates(draft([role, date], repeated, ['date']))).toEqual([]);
    expect(findUngroupedDates(draft([role, date], repeated, ['role']))).toEqual([]);
  });

  it('says nothing when every slot shares one date', () => {
    const input = draft(
      [role, date],
      [
        slot('s1', { role: 'Setup', date: '2026-11-07' }),
        slot('s2', { role: 'Cleanup', date: '2026-11-07' }),
      ],
    );
    expect(findUngroupedDates(input)).toEqual([]);
  });

  it('says nothing when no date repeats', () => {
    const input = draft(
      [date],
      [slot('s1', { date: '2026-11-07' }), slot('s2', { date: '2026-11-14' })],
    );
    expect(findUngroupedDates(input)).toEqual([]);
  });

  it('says nothing without a date field', () => {
    const day = field('day');
    const input = draft(
      [day],
      [slot('s1', { day: 'Sat' }), slot('s2', { day: 'Sat' }), slot('s3', { day: 'Sun' })],
    );
    expect(findUngroupedDates(input)).toEqual([]);
  });
});

describe('findTimeInText', () => {
  it('finds times of day written into a text field', () => {
    const when = field('when');
    const times = ['9:00', '14:30', '9am', '9 am', '9:30pm', '9 a.m.', 'Sat 10 AM', 'Doors 7:15'];
    const input = draft(
      [role, when],
      [
        ...times.map((t, i) => slot(`s${i}`, { role: 'Setup', when: t })),
        slot('plain', { role: 'Setup', when: 'Morning' }),
      ],
    );
    expect(findTimeInText(input)).toEqual([
      { kind: 'time_in_text', fieldId: 'fld_when', slotIds: times.map((_, i) => `s${i}`) },
    ]);
  });

  it('leaves numbers, ranges and dates alone', () => {
    const when = field('when');
    const notTimes = [
      '8–12',
      'Ages 8-12',
      'Ages 8–12',
      '12',
      '2026-11-07',
      '11/07',
      'Room 9',
      '9 apples',
      '24:00',
      '9:7',
      '3.5',
    ];
    const input = draft(
      [when],
      notTimes.map((t, i) => slot(`s${i}`, { when: t })),
    );
    expect(findTimeInText(input)).toEqual([]);
  });

  it('says nothing when the signup has a time field', () => {
    const when = field('when');
    const input = draft([when, time], [slot('s1', { when: 'Sat 9am', time: '09:00' })]);
    expect(findTimeInText(input)).toEqual([]);
  });

  it('only reads text fields, and names the first one that holds a time', () => {
    const shift = field('shift', 'enum');
    const first = field('first');
    const second = field('second');
    const input = draft(
      [shift, first, second],
      [
        slot('s1', { shift: '9am', first: 'Setup', second: 'Gym, 9am' }),
        slot('s2', { shift: '9am', first: 'Snacks 10:30', second: 'Gym, 9am' }),
      ],
    );
    expect(findTimeInText(input)).toEqual([
      { kind: 'time_in_text', fieldId: 'fld_first', slotIds: ['s2'] },
    ]);
  });
});

describe('checkDraft', () => {
  it('returns every notice, in build order', () => {
    const notes = field('notes', 'text', 'Untitled');
    const when = field('when');
    const input = draft(
      [role, date, when, notes],
      [
        slot('s1', { role: 'TBD: game 1', date: '2026-11-07', when: '9am' }),
        slot('s2', {}),
        slot('s3', { role: 'Setup', date: '2026-11-07', when: 'Morning' }),
        slot('s4', { role: 'Setup', date: '2026-11-07', when: 'Morning' }),
        slot('s5', { role: 'Cleanup', date: '2026-11-14', when: 'Evening' }),
      ],
    );
    expect(checkDraft(input)).toEqual([
      { kind: 'placeholder', slotIds: ['s1'], word: 'TBD' },
      { kind: 'empty_field', fieldId: 'fld_notes', ref: 'notes' },
      { kind: 'blank_slot', slotIds: ['s2'] },
      {
        kind: 'duplicate_slots',
        slotIds: ['s3', 's4'],
        keepSlotId: 's3',
        capacity: 2,
        values: { role: 'Setup', date: '2026-11-07', when: 'Morning' },
        numbered: false,
      },
      { kind: 'unnamed_field', fieldId: 'fld_notes' },
      { kind: 'ungrouped_dates', fieldId: 'fld_date', ref: 'date' },
      { kind: 'time_in_text', fieldId: 'fld_when', slotIds: ['s1'] },
    ]);
  });

  it('is empty for a tidy draft', () => {
    const input = draft(
      [date, time, role],
      [
        slot('s1', { date: '2026-11-07', time: '09:00', role: 'Setup' }, 4),
        slot('s2', { date: '2026-11-07', time: '15:00', role: 'Cleanup' }, 2),
        slot('s3', { date: '2026-11-14', time: '09:00', role: 'Setup' }, 4),
      ],
      ['date'],
    );
    expect(checkDraft(input)).toEqual([]);
  });

  it('is empty for a draft with no fields or slots', () => {
    expect(checkDraft(draft([], []))).toEqual([]);
  });
});

describe('near misses found in review', () => {
  it('never counts a closed slot as a copy of an open one', () => {
    const input = draft(
      [role],
      [
        { ...slot('s1', { role: 'Setup' }, 2), status: 'open' },
        { ...slot('s2', { role: 'Setup' }, 3), status: 'closed' },
      ],
    );
    expect(findDuplicateSlots(input)).toEqual([]);
  });

  it('marks numbered rows as numbered, so the page can say they differ only by a number', () => {
    const input = draft([role], [slot('s1', { role: 'Lane 1' }), slot('s2', { role: 'Lane 2' })]);
    expect(findDuplicateSlots(input)).toMatchObject([{ numbered: true, values: { role: 'Lane' } }]);
  });

  it('leaves grouping alone when most dates have one slot each', () => {
    const dates = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
    const slots = dates.map((d, i) => slot(`s${i}`, { role: 'Snacks', date: `2026-11-${d}` }));
    slots.push(slot('s10', { role: 'Drinks', date: '2026-11-01' }));
    expect(findUngroupedDates(draft([role, date], slots))).toEqual([]);
  });

  it('reads a bare clock time only when its minutes are on a five', () => {
    expect(
      findTimeInText(draft([role], [slot('s1', { role: 'John 3:16' }), slot('s2', { role: 'Final 21:14' })])),
    ).toEqual([]);
    expect(findTimeInText(draft([role], [slot('s1', { role: 'Setup 9:05' })]))).toMatchObject([
      { kind: 'time_in_text', slotIds: ['s1'] },
    ]);
  });
});
