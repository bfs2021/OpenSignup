import { describe, expect, it } from 'vitest';
import type { DraftFixUndo, RemoveDayRequest, SetCapacityRequest } from '@/schemas/draft-fixes';
import { serviceError } from '@/lib/errors';
import type { SlotFieldDefinition } from '@/schemas/slot-fields';
import type { SlotUnmergeInput } from '@/schemas/slots';
import { checkDraft, type DraftNotice, type DraftNoticeOf } from './draft-checks';
import {
  buildUndo,
  capacitiesRefusal,
  capacityOffer,
  draftInputOf,
  findCapacitySlots,
  findDayFor,
  findNoticeFor,
  fixRequestFor,
  labelProblem,
  draftSlotsRefusal,
  mergeRequestFor,
  planUndo,
  removableDays,
  removeDayRequest,
  removeDayUndo,
  restoredLabel,
  setCapacityUndo,
  slotSetFingerprint,
  type DraftState,
} from './draft-fixes';

function field(
  id: string,
  ref: string,
  label: string,
  fieldType: SlotFieldDefinition['fieldType'],
  sortOrder: number,
): SlotFieldDefinition {
  const config: SlotFieldDefinition['config'] =
    fieldType === 'text'
      ? { fieldType: 'text', maxLength: 200 }
      : ({ fieldType } as SlotFieldDefinition['config']);
  return { id, ref, label, fieldType, sortOrder, config };
}

const what = field('f_what', 'what', 'What', 'text', 0);
const date = field('f_date', 'date', 'Date', 'date', 1);
const notes = field('f_notes', 'notes', 'Notes', 'text', 2);
const untitled = field('f_x', 'x', 'Untitled', 'text', 3);

function slot(
  id: string,
  values: Record<string, unknown>,
  extra: { capacity?: number | null; sortOrder?: number; status?: string } = {},
) {
  return {
    id,
    values,
    capacity: extra.capacity === undefined ? 1 : extra.capacity,
    sortOrder: extra.sortOrder ?? 0,
    status: extra.status ?? 'open',
  };
}

function state(partial: Partial<DraftState>): DraftState {
  return { fields: [what, date], slots: [], settings: {}, ...partial };
}

function noticesOf(s: DraftState): DraftNotice[] {
  return checkDraft(draftInputOf(s));
}

function only<K extends DraftNotice['kind']>(s: DraftState, kind: K): DraftNoticeOf<K> {
  const found = noticesOf(s).filter((n): n is DraftNoticeOf<K> => n.kind === kind);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe('draftInputOf', () => {
  it('passes the fields and slots on, and reads the grouping as the slot list does', () => {
    const slots = [slot('a', { what: 'Setup' })];
    expect(
      draftInputOf({ fields: [what], slots, settings: { groupByFieldRefs: ['what'] } }),
    ).toEqual({
      fields: [what],
      slots,
      settings: { groupByFieldRefs: ['what'] },
    });
  });

  it('reads settings it cannot make sense of as not grouped', () => {
    for (const settings of [null, 'x', { groupByFieldRefs: 'what' }, { groupByFieldRefs: [7] }]) {
      expect(draftInputOf({ fields: [], slots: [], settings }).settings).toEqual({
        groupByFieldRefs: [],
      });
    }
  });
});

describe('findNoticeFor', () => {
  const notices: DraftNotice[] = [
    { kind: 'empty_field', fieldId: 'f_notes', ref: 'notes' },
    { kind: 'blank_slot', slotIds: ['c', 'd'] },
    { kind: 'unnamed_field', fieldId: 'f_x' },
    { kind: 'ungrouped_dates', fieldId: 'f_date', ref: 'date' },
  ];

  it('finds the notice of the same kind about the same field', () => {
    expect(findNoticeFor(notices, { kind: 'empty_field', fieldId: 'f_notes' })).toBe(notices[0]);
    expect(findNoticeFor(notices, { kind: 'unnamed_field', fieldId: 'f_x', label: 'Shift' })).toBe(
      notices[2],
    );
    expect(findNoticeFor(notices, { kind: 'ungrouped_dates', fieldId: 'f_date' })).toBe(notices[3]);
  });

  it('never matches a field by another kind', () => {
    expect(findNoticeFor(notices, { kind: 'empty_field', fieldId: 'f_x' })).toBeNull();
    expect(findNoticeFor(notices, { kind: 'ungrouped_dates', fieldId: 'f_notes' })).toBeNull();
  });

  it('matches blank slots only when they are exactly the same slots, in any order', () => {
    expect(findNoticeFor(notices, { kind: 'blank_slot', slotIds: ['d', 'c'] })).toBe(notices[1]);
    expect(findNoticeFor(notices, { kind: 'blank_slot', slotIds: ['c'] })).toBeNull();
    expect(findNoticeFor(notices, { kind: 'blank_slot', slotIds: ['c', 'd', 'e'] })).toBeNull();
    expect(findNoticeFor(notices, { kind: 'blank_slot', slotIds: ['c', 'c'] })).toBeNull();
  });

  it('finds nothing once the problem is gone', () => {
    expect(findNoticeFor([], { kind: 'empty_field', fieldId: 'f_notes' })).toBeNull();
  });

  it('matches copies only when they are exactly the same slots, in any order', () => {
    const copies: DraftNotice[] = [
      ...notices,
      {
        kind: 'duplicate_slots',
        slotIds: ['a', 'b'],
        keepSlotId: 'a',
        capacity: 2,
        values: {},
        numbered: false,
      },
      {
        kind: 'duplicate_slots',
        slotIds: ['e', 'f', 'g'],
        keepSlotId: 'e',
        capacity: 3,
        values: {},
        numbered: true,
      },
    ];
    expect(findNoticeFor(copies, { kind: 'duplicate_slots', slotIds: ['b', 'a'] })).toBe(copies[4]);
    expect(findNoticeFor(copies, { kind: 'duplicate_slots', slotIds: ['e', 'f', 'g'] })).toBe(
      copies[5],
    );
    // A copy added or merged away since: not the set the organizer saw.
    expect(findNoticeFor(copies, { kind: 'duplicate_slots', slotIds: ['e', 'f'] })).toBeNull();
    expect(findNoticeFor(copies, { kind: 'duplicate_slots', slotIds: ['a', 'b', 'e'] })).toBeNull();
    // Blank slots are never copies, whatever ids are sent.
    expect(findNoticeFor(copies, { kind: 'duplicate_slots', slotIds: ['c', 'd'] })).toBeNull();
  });
});

describe('fixRequestFor', () => {
  it('is what each button sends', () => {
    expect(fixRequestFor({ kind: 'empty_field', fieldId: 'f', ref: 'r' })).toEqual({
      kind: 'empty_field',
      fieldId: 'f',
    });
    expect(fixRequestFor({ kind: 'blank_slot', slotIds: ['a', 'b'] })).toEqual({
      kind: 'blank_slot',
      slotIds: ['a', 'b'],
    });
    expect(fixRequestFor({ kind: 'ungrouped_dates', fieldId: 'f', ref: 'r' })).toEqual({
      kind: 'ungrouped_dates',
      fieldId: 'f',
    });
    expect(
      fixRequestFor({
        kind: 'duplicate_slots',
        slotIds: ['a', 'b'],
        keepSlotId: 'a',
        capacity: 2,
        values: { what: 'Setup' },
        numbered: false,
      }),
    ).toEqual({ kind: 'duplicate_slots', slotIds: ['a', 'b'] });
  });

  it('has none for a field with no name (it takes a name) or a kind with no fix', () => {
    expect(fixRequestFor({ kind: 'unnamed_field', fieldId: 'f' })).toBeNull();
    expect(fixRequestFor({ kind: 'placeholder', slotIds: ['a'], word: 'TBD' })).toBeNull();
  });
});

describe('mergeRequestFor', () => {
  it('keeps the kept slot’s own values for identical copies', () => {
    const before = state({
      fields: [what],
      slots: [
        slot('a', { what: 'Setup ' }, { capacity: 2 }),
        slot('b', { what: 'Setup' }),
        slot('c', { what: 'Till' }),
      ],
    });
    expect(mergeRequestFor(only(before, 'duplicate_slots'))).toEqual({
      keepSlotId: 'a',
      slotIds: ['a', 'b'],
    });
  });

  it('sends the values without the number for numbered rows', () => {
    const before = state({
      slots: [
        slot('a', { date: '2030-11-14', what: 'Helper 1' }),
        slot('b', { what: 'Helper 2', date: '2030-11-14' }),
        slot('c', { what: 'Setup', date: '2030-11-14' }),
      ],
    });
    expect(mergeRequestFor(only(before, 'duplicate_slots'))).toEqual({
      keepSlotId: 'a',
      slotIds: ['a', 'b'],
      values: { date: '2030-11-14', what: 'Helper' },
    });
  });
});

describe('draftSlotsRefusal', () => {
  const refused = (code: 'conflict' | 'invalid_input' | 'not_found', field?: string) =>
    serviceError(code, 'service words', field !== undefined ? { field, received: 'x' } : {});
  const reasonOf = (e: { details?: Record<string, unknown> }) => e.details?.reason;

  it('reads a signup no longer a draft as that, for a merge and an undo', () => {
    expect(reasonOf(draftSlotsRefusal(refused('conflict', 'status'), 'fix'))).toBe('not_draft');
    expect(reasonOf(draftSlotsRefusal(refused('conflict', 'status'), 'undo'))).toBe('not_draft');
  });

  it('reads as stale only what a change since causes a merge to refuse', () => {
    // A copy closed, booked or no longer a copy; values no longer the shared ones.
    for (const field of ['slotIds', 'values']) {
      expect(reasonOf(draftSlotsRefusal(refused('conflict', field), 'fix'))).toBe('stale');
    }
    // A copy deleted since.
    expect(reasonOf(draftSlotsRefusal(refused('invalid_input', 'slotIds'), 'fix'))).toBe('stale');
  });

  it('never reads as stale what no change caused, which would offer the same button again', () => {
    // The input itself, or values the fields refuse.
    for (const field of ['keepSlotId', 'what', undefined]) {
      expect(draftSlotsRefusal(refused('invalid_input', field), 'fix')).toEqual({
        code: 'invalid_input',
        message: 'service words',
      });
    }
    // A total too big for one slot.
    expect(draftSlotsRefusal(refused('conflict', 'capacity'), 'fix')).toEqual({
      code: 'invalid_input',
      message: 'service words',
    });
  });

  it('reads an undo’s conflicts as changed, and passes the rest on without their field', () => {
    for (const field of ['keepSlotId', 'capacity']) {
      expect(reasonOf(draftSlotsRefusal(refused('conflict', field), 'undo'))).toBe('changed');
    }
    // A value for a field deleted since, and that field could be called "label".
    expect(draftSlotsRefusal(refused('invalid_input', 'label'), 'undo')).toEqual({
      code: 'invalid_input',
      message: 'service words',
    });
    expect(draftSlotsRefusal(refused('not_found'), 'undo')).toEqual({
      code: 'not_found',
      message: 'service words',
    });
  });

  it('never passes a slot field’s ref on as the refusal’s field', () => {
    for (const step of ['fix', 'undo'] as const) {
      expect(draftSlotsRefusal(refused('invalid_input', 'label'), step).field).toBeUndefined();
    }
  });
});

describe('labelProblem', () => {
  it('takes a real name, trimmed', () => {
    expect(labelProblem('  Shift ')).toBeNull();
  });

  it('refuses a blank name, one too long, and the builder’s default in any case', () => {
    expect(labelProblem('   ')).toBe('blank');
    expect(labelProblem('x'.repeat(81))).toBe('too_long');
    expect(labelProblem(` ${'x'.repeat(80)} `)).toBeNull();
    expect(labelProblem(' untitled ')).toBe('untitled');
  });
});

describe('buildUndo', () => {
  it('remembers a removed field, the field after it, and only the settings that named it', () => {
    const before = state({
      fields: [what, date, notes],
      slots: [slot('a', { what: 'Setup', date: '2030-11-14' })],
      settings: { groupByFieldRefs: ['date'], reminderFromFieldRef: 'date', requireEmail: false },
    });
    const notice = only(before, 'empty_field');
    expect(notice.fieldId).toBe('f_notes');
    expect(buildUndo(notice, before)).toEqual({
      kind: 'empty_field',
      field: { ref: 'notes', label: 'Notes', fieldType: 'text', config: notes.config },
      beforeFieldId: null,
      settings: {},
    });

    const dated = state({
      fields: [what, date, notes],
      slots: [slot('a', { what: 'Setup', notes: 'Bring gloves' })],
      settings: { groupByFieldRefs: ['date'], reminderFromFieldRef: 'date' },
    });
    expect(buildUndo(only(dated, 'empty_field'), dated)).toEqual({
      kind: 'empty_field',
      field: { ref: 'date', label: 'Date', fieldType: 'date', config: { fieldType: 'date' } },
      beforeFieldId: 'f_notes',
      // The anchor deleting it leaves: no other date field, so none.
      settings: { reminderFromFieldRef: 'date', anchorAfter: null, groupByFieldRefs: ['date'] },
    });
  });

  it('remembers the anchor deleting the field moves to', () => {
    const start = field('f_start', 'start', 'Start', 'date', 3);
    const before = state({
      fields: [what, date, notes, start],
      slots: [slot('a', { what: 'Setup', notes: 'Gloves', start: '2030-11-14' })],
      settings: { reminderFromFieldRef: 'date' },
    });
    expect(buildUndo(only(before, 'empty_field'), before)).toMatchObject({
      settings: { reminderFromFieldRef: 'date', anchorAfter: 'start' },
    });
  });

  it('remembers removed slots as they were, in list order, and leaves the others out', () => {
    const before = state({
      slots: [
        slot('a', { what: 'Setup' }, { sortOrder: 0 }),
        slot('c', {}, { sortOrder: 1, capacity: null }),
        slot('b', { what: 'Till' }, { sortOrder: 2 }),
        slot('d', { what: ' ', date: null }, { sortOrder: 3, capacity: 4, status: 'closed' }),
      ],
    });
    expect(buildUndo(only(before, 'blank_slot'), before)).toEqual({
      kind: 'blank_slot',
      slots: [
        { values: {}, capacity: null, sortOrder: 1, closed: false },
        { values: { what: ' ', date: null }, capacity: 4, sortOrder: 3, closed: true },
      ],
    });
  });

  it('remembers a field’s old name and the trimmed new one', () => {
    const before = state({
      fields: [what, untitled],
      slots: [slot('a', { what: 'Setup', x: 'y' })],
    });
    expect(buildUndo(only(before, 'unnamed_field'), before, '  Shift ')).toEqual({
      kind: 'unnamed_field',
      fieldId: 'f_x',
      label: 'Shift',
      previous: 'Untitled',
    });
  });

  it('remembers the grouping as stored, even one naming a field that is gone', () => {
    const slots = [
      slot('a', { what: 'Setup', date: '2030-11-14' }),
      slot('b', { what: 'Till', date: '2030-11-14' }),
      slot('c', { what: 'Setup', date: '2030-11-15' }),
      slot('d', { what: 'Till', date: '2030-11-15' }),
    ];
    const stale = state({ slots, settings: { groupByFieldRefs: ['gone'] } });
    expect(buildUndo(only(stale, 'ungrouped_dates'), stale)).toEqual({
      kind: 'ungrouped_dates',
      ref: 'date',
      previous: ['gone'],
    });
    const none = state({ slots, settings: {} });
    expect(buildUndo(only(none, 'ungrouped_dates'), none)).toEqual({
      kind: 'ungrouped_dates',
      ref: 'date',
      previous: [],
    });
  });
});

describe('buildUndo for a merge', () => {
  const unmerge: SlotUnmergeInput = {
    keepSlotId: 'a',
    keptUpdatedAt: '2030-01-01T00:00:00.000Z',
    previous: { values: { what: 'Helper 1' }, capacity: 1 },
    restored: [{ values: { what: 'Helper 2' }, capacity: 1, sortOrder: 1 }],
  };
  const before = state({
    fields: [what],
    slots: [slot('a', { what: 'Helper 1' }), slot('b', { what: 'Helper 2' }, { sortOrder: 1 })],
  });

  it('passes on what the merge service gave back, as it is', () => {
    expect(buildUndo(only(before, 'duplicate_slots'), before, '', unmerge)).toEqual({
      kind: 'duplicate_slots',
      unmerge,
    });
  });

  it('has nothing to build a merge’s undo from on its own', () => {
    expect(() => buildUndo(only(before, 'duplicate_slots'), before)).toThrow();
  });
});

describe('planUndo', () => {
  const removedNotes: DraftFixUndo = {
    kind: 'empty_field',
    field: { ref: 'notes', label: 'Notes', fieldType: 'text', config: notes.config },
    beforeFieldId: 'f_date',
    settings: {},
  };

  it('puts a field back in front of the field that followed it', () => {
    expect(planUndo(removedNotes, state({ fields: [what, date] }))).toEqual({
      kind: 'empty_field',
      field: removedNotes.field,
      beforeFieldId: 'f_date',
      settings: null,
    });
  });

  it('puts it last when it was last, or the field after it has gone', () => {
    expect(planUndo({ ...removedNotes, beforeFieldId: null }, state({}))).toMatchObject({
      beforeFieldId: undefined,
    });
    expect(planUndo(removedNotes, state({ fields: [what] }))).toMatchObject({
      beforeFieldId: undefined,
    });
  });

  it('can’t undo once a field of that ref is back', () => {
    expect(planUndo(removedNotes, state({ fields: [what, date, notes] }))).toBeNull();
  });

  it('gives a field that had no name the builder’s default, as a field needs one', () => {
    expect(
      planUndo({ ...removedNotes, field: { ...removedNotes.field, label: ' ' } }, state({})),
    ).toMatchObject({ field: { label: 'Untitled' } });
  });

  it('puts the anchor and the grouping back, unless the page was grouped since', () => {
    const removedDate: DraftFixUndo = {
      kind: 'empty_field',
      field: { ref: 'date', label: 'Date', fieldType: 'date', config: { fieldType: 'date' } },
      beforeFieldId: null,
      settings: { reminderFromFieldRef: 'date', anchorAfter: null, groupByFieldRefs: ['date'] },
    };
    expect(planUndo(removedDate, state({ fields: [what], settings: {} }))).toMatchObject({
      settings: { reminderFromFieldRef: 'date', groupByFieldRefs: ['date'] },
    });
    expect(
      planUndo(removedDate, state({ fields: [what], settings: { groupByFieldRefs: ['what'] } })),
    ).toBeNull();
  });

  it('puts the anchor back only while it is where deleting the field left it', () => {
    const start = field('f_start', 'start', 'Start', 'date', 2);
    const end = field('f_end', 'end', 'End', 'date', 3);
    const removedDate: DraftFixUndo = {
      kind: 'empty_field',
      field: { ref: 'date', label: 'Date', fieldType: 'date', config: { fieldType: 'date' } },
      beforeFieldId: null,
      settings: { reminderFromFieldRef: 'date', anchorAfter: 'start' },
    };
    const fields = [what, start, end];
    expect(
      planUndo(removedDate, state({ fields, settings: { reminderFromFieldRef: 'start' } })),
    ).toMatchObject({ settings: { reminderFromFieldRef: 'date' } });
    // The organizer picked End since: Undo would overwrite that choice.
    expect(
      planUndo(removedDate, state({ fields, settings: { reminderFromFieldRef: 'end' } })),
    ).toBeNull();
  });

  it('adds blank slots back with the values of the fields that still exist', () => {
    const undo: DraftFixUndo = {
      kind: 'blank_slot',
      slots: [
        { values: { what: '', notes: null }, capacity: null, sortOrder: 1, closed: false },
        { values: {}, capacity: 3, sortOrder: 4, closed: true },
      ],
    };
    expect(planUndo(undo, state({ fields: [what, date] }))).toEqual({
      kind: 'blank_slot',
      rows: [
        { values: { what: '' }, capacity: null, sortOrder: 1 },
        { values: {}, capacity: 3, sortOrder: 4 },
      ],
      closed: [1],
    });
  });

  it('can’t add blank slots back twice', () => {
    const undo: DraftFixUndo = {
      kind: 'blank_slot',
      slots: [{ values: {}, capacity: 1, sortOrder: 0, closed: false }],
    };
    // An undo whose answer was lost already put this one back.
    const again = state({
      slots: [slot('a', { what: 'Setup' }, { sortOrder: 1 }), slot('b', {}, { sortOrder: 0 })],
    });
    expect(planUndo(undo, again)).toBeNull();
  });

  it('adds back only blank slots', () => {
    const undo: DraftFixUndo = {
      kind: 'blank_slot',
      slots: [{ values: { what: 'Setup' }, capacity: 1, sortOrder: 0, closed: false }],
    };
    expect(planUndo(undo, state({}))).toBeNull();
  });

  it('gives a field its old name back while it still has the name the fix gave it', () => {
    const undo: DraftFixUndo = {
      kind: 'unnamed_field',
      fieldId: 'f_x',
      label: 'Shift',
      previous: 'Untitled',
    };
    const renamed = { ...untitled, label: 'Shift' };
    expect(planUndo(undo, state({ fields: [what, renamed] }))).toEqual({
      kind: 'unnamed_field',
      fieldId: 'f_x',
      label: 'Untitled',
    });
    expect(planUndo({ ...undo, previous: '' }, state({ fields: [renamed] }))).toMatchObject({
      label: 'Untitled',
    });
    expect(planUndo(undo, state({ fields: [{ ...untitled, label: 'Role' }] }))).toBeNull();
    expect(planUndo(undo, state({ fields: [what] }))).toBeNull();
  });

  it('puts the grouping back while the page is still grouped as the fix left it', () => {
    const undo: DraftFixUndo = { kind: 'ungrouped_dates', ref: 'date', previous: ['gone'] };
    expect(planUndo(undo, state({ settings: { groupByFieldRefs: ['date'] } }))).toEqual({
      kind: 'ungrouped_dates',
      groupByFieldRefs: ['gone'],
    });
    expect(planUndo(undo, state({ settings: { groupByFieldRefs: ['what'] } }))).toBeNull();
    expect(planUndo(undo, state({ settings: {} }))).toBeNull();
  });
});

describe('planUndo for a merge', () => {
  const unmerge: SlotUnmergeInput = {
    keepSlotId: 'a',
    keptUpdatedAt: '2030-01-01T00:00:00.000Z',
    previous: { values: { what: 'Helper 1' }, capacity: 1 },
    restored: [
      { values: { what: 'Helper 2' }, capacity: 1, sortOrder: 1 },
      { values: { what: 'Helper 3' }, capacity: 2, sortOrder: 2 },
    ],
  };
  const undo: DraftFixUndo = { kind: 'duplicate_slots', unmerge };

  it('passes the undo on to the merge service while the kept slot is there', () => {
    const merged = state({
      fields: [what],
      slots: [slot('a', { what: 'Helper' }, { capacity: 4 })],
    });
    expect(planUndo(undo, merged)).toEqual({ kind: 'duplicate_slots', unmerge });
  });

  it('leaves whether the kept slot changed to the service, which checks it under its lock', () => {
    // A copy of it added since doesn't stop a first undo.
    const copied = state({
      fields: [what],
      slots: [
        slot('a', { what: 'Helper' }, { capacity: 4 }),
        slot('z', { what: 'Helper' }, { capacity: 4, sortOrder: 9 }),
      ],
    });
    expect(planUndo(undo, copied)).toEqual({ kind: 'duplicate_slots', unmerge });
  });

  it('can’t once the kept slot is gone', () => {
    expect(planUndo(undo, state({ fields: [what], slots: [] }))).toBeNull();
  });
});

describe('restoredLabel', () => {
  it('keeps a name, and gives a blank one the builder’s default', () => {
    expect(restoredLabel('Role')).toBe('Role');
    expect(restoredLabel('')).toBe('Untitled');
    expect(restoredLabel('  ')).toBe('Untitled');
  });
});

// A fix and its undo, the way the service runs them, on made-up data: what
// the undo plans to put back is what the fix took away.
describe('a fix and its undo', () => {
  it('puts a removed field back where it was, with the settings that named it', () => {
    const before = state({
      fields: [what, notes, date],
      slots: [slot('a', { what: 'Setup', date: '2030-11-14' })],
      settings: { groupByFieldRefs: ['notes'] },
    });
    const notice = only(before, 'empty_field');
    const undo = buildUndo(notice, before);
    // After deleteField: the field is gone, and so is the grouping by it.
    const after = state({ fields: [what, date], slots: before.slots, settings: {} });
    expect(planUndo(undo, after)).toEqual({
      kind: 'empty_field',
      field: { ref: 'notes', label: 'Notes', fieldType: 'text', config: notes.config },
      beforeFieldId: 'f_date',
      settings: { groupByFieldRefs: ['notes'] },
    });
  });
});

// Remove day (#504): one date's group of the review page's slot list.
describe('removableDays', () => {
  const byDate = { groupByFieldRefs: ['date'] };
  const week = state({
    settings: byDate,
    slots: [
      slot('a', { what: 'Setup', date: '2030-04-06' }, { sortOrder: 0 }),
      slot('b', { what: 'Till', date: '2030-04-13' }, { sortOrder: 1 }),
      slot('c', { what: 'Cleanup', date: '2030-04-06' }, { sortOrder: 2 }),
      slot('d', { what: 'Raffle' }, { sortOrder: 3 }),
    ],
  });

  it('is each date’s group, as the page lists and names them, with every slot in it', () => {
    expect(removableDays(week)).toEqual([
      {
        ref: 'date',
        value: '2030-04-06',
        label: 'Sat, Apr 6',
        slotIds: ['a', 'c'],
        fingerprint: slotSetFingerprint(['a', 'c']),
      },
      {
        ref: 'date',
        value: '2030-04-13',
        label: 'Sat, Apr 13',
        slotIds: ['b'],
        fingerprint: slotSetFingerprint(['b']),
      },
    ]);
  });

  it('is never the group of slots with no date', () => {
    expect(removableDays(week).map((d) => d.value)).not.toContain('__unset__');
  });

  it('is none on a page not grouped, or grouped by a field that isn’t a date', () => {
    expect(removableDays({ ...week, settings: {} })).toEqual([]);
    expect(removableDays({ ...week, settings: { groupByFieldRefs: ['what'] } })).toEqual([]);
    // Grouped by a field the signup no longer has.
    expect(removableDays({ ...week, fields: [what] })).toEqual([]);
  });

  it('reads the grouping as the slot list does: the first field named', () => {
    expect(removableDays({ ...week, settings: { groupByFieldRefs: ['what', 'date'] } })).toEqual(
      [],
    );
    expect(
      removableDays({ ...week, settings: { groupByFieldRefs: ['date', 'what'] } }),
    ).toHaveLength(2);
  });

  it('leaves out a day holding the only slots with anything filled in', () => {
    const lone = state({
      settings: byDate,
      slots: [
        slot('a', { what: 'Setup', date: '2030-04-06' }),
        slot('b', { what: ' ' }),
        slot('c', {}),
      ],
    });
    expect(removableDays(lone)).toEqual([]);
    // A date counts as filled in, as on the page.
    const twoDays = state({
      settings: byDate,
      slots: [slot('a', { what: 'Setup', date: '2030-04-06' }), slot('b', { date: '2030-04-13' })],
    });
    expect(removableDays(twoDays).map((d) => d.value)).toEqual(['2030-04-06', '2030-04-13']);
  });

  it('leaves out a day with more slots than Undo can add back in one go', () => {
    const big = state({
      settings: byDate,
      slots: [
        ...Array.from({ length: 501 }, (_, i) => slot(`s${i}`, { date: '2030-04-06' })),
        slot('x', { what: 'Till', date: '2030-04-13' }),
      ],
    });
    expect(removableDays(big).map((d) => d.value)).toEqual(['2030-04-13']);
  });

  it('is what Remove day sends: the day and its slots’ fingerprint, never their ids', () => {
    expect(removeDayRequest(removableDays(week)[0]!)).toEqual({
      kind: 'remove_day',
      ref: 'date',
      value: '2030-04-06',
      fingerprint: slotSetFingerprint(['a', 'c']),
    });
  });
});

describe('slotSetFingerprint', () => {
  it('is the same for the same slots in any order, and short', () => {
    const ids = ['slot_0b', 'slot_0a', 'slot_0c'];
    expect(slotSetFingerprint(ids)).toBe(slotSetFingerprint([...ids].reverse()));
    expect(slotSetFingerprint(ids)).toMatch(/^3\.[\w-]{16}$/);
  });

  it('changes when a slot is added, taken away or swapped', () => {
    const base = slotSetFingerprint(['a', 'b']);
    expect(slotSetFingerprint(['a', 'b', 'c'])).not.toBe(base);
    expect(slotSetFingerprint(['a'])).not.toBe(base);
    expect(slotSetFingerprint(['a', 'c'])).not.toBe(base);
    // Joined so that ids can't run into each other.
    expect(slotSetFingerprint(['ab', 'c'])).not.toBe(slotSetFingerprint(['a', 'bc']));
  });
});

describe('findDayFor', () => {
  const now = state({
    settings: { groupByFieldRefs: ['date'] },
    slots: [
      slot('a', { what: 'Setup', date: '2030-04-06' }),
      slot('b', { what: 'Till', date: '2030-04-13' }),
      slot('c', { what: 'Cleanup', date: '2030-04-06' }),
    ],
  });
  const request: RemoveDayRequest = {
    kind: 'remove_day',
    ref: 'date',
    value: '2030-04-06',
    fingerprint: slotSetFingerprint(['c', 'a']),
  };

  it('finds the day with exactly the slots the page showed', () => {
    expect(findDayFor(now, request)).toMatchObject({
      ref: 'date',
      value: '2030-04-06',
      label: 'Sat, Apr 6',
      slotIds: ['a', 'c'],
    });
  });

  it('finds nothing once a slot moved into the day or out of it, or the day is gone', () => {
    const moved = state({ ...now, slots: [now.slots[0]!, now.slots[1]!] });
    expect(findDayFor(moved, request)).toBeNull();
    const added = state({ ...now, slots: [...now.slots, slot('d', { date: '2030-04-06' })] });
    expect(findDayFor(added, request)).toBeNull();
    expect(findDayFor(now, { ...request, value: '2030-04-20' })).toBeNull();
    expect(findDayFor(now, { ...request, fingerprint: slotSetFingerprint(['a']) })).toBeNull();
  });

  it('finds nothing on a page grouped another way since, or by another field', () => {
    expect(findDayFor({ ...now, settings: {} }, request)).toBeNull();
    expect(findDayFor(now, { ...request, ref: 'what' })).toBeNull();
  });

  it('never finds the slots with no date', () => {
    const undated = state({
      settings: { groupByFieldRefs: ['date'] },
      slots: [slot('a', { what: 'Setup' }), slot('b', { what: 'Till', date: '2030-04-13' })],
    });
    expect(
      findDayFor(undated, {
        kind: 'remove_day',
        ref: 'date',
        value: '__unset__',
        fingerprint: slotSetFingerprint(['a']),
      }),
    ).toBeNull();
  });
});

describe('removeDayUndo', () => {
  it('remembers the day’s slots as they were, in list order, and the day', () => {
    const before = state({
      settings: { groupByFieldRefs: ['date'] },
      slots: [
        slot('a', { what: 'Setup', date: '2030-04-06' }, { sortOrder: 0, capacity: 2 }),
        slot('b', { what: 'Till', date: '2030-04-13' }, { sortOrder: 1 }),
        slot(
          'c',
          { what: 'Cleanup', date: '2030-04-06' },
          { sortOrder: 2, capacity: null, status: 'closed' },
        ),
      ],
    });
    const day = removableDays(before)[0]!;
    expect(removeDayUndo(day, before)).toEqual({
      kind: 'remove_day',
      ref: 'date',
      value: '2030-04-06',
      slots: [
        { values: { what: 'Setup', date: '2030-04-06' }, capacity: 2, sortOrder: 0, closed: false },
        {
          values: { what: 'Cleanup', date: '2030-04-06' },
          capacity: null,
          sortOrder: 2,
          closed: true,
        },
      ],
    });
  });
});

describe('planUndo for Remove day', () => {
  const undo: DraftFixUndo = {
    kind: 'remove_day',
    ref: 'date',
    value: '2030-04-06',
    slots: [
      {
        values: { what: 'Setup', date: '2030-04-06', notes: 'Gym' },
        capacity: 2,
        sortOrder: 0,
        closed: false,
      },
      {
        values: { what: 'Cleanup', date: '2030-04-06' },
        capacity: null,
        sortOrder: 2,
        closed: true,
      },
    ],
  };
  const after = state({
    settings: { groupByFieldRefs: ['date'] },
    slots: [slot('b', { what: 'Till', date: '2030-04-13' }, { sortOrder: 1 })],
  });

  it('adds the slots back as they were, filled in or not, with the fields that still exist', () => {
    expect(planUndo(undo, after)).toEqual({
      kind: 'remove_day',
      rows: [
        { values: { what: 'Setup', date: '2030-04-06' }, capacity: 2, sortOrder: 0 },
        { values: { what: 'Cleanup', date: '2030-04-06' }, capacity: null, sortOrder: 2 },
      ],
      closed: [1],
    });
  });

  it('adds them back on a page grouped another way since', () => {
    expect(planUndo(undo, { ...after, settings: {} })).toMatchObject({ kind: 'remove_day' });
  });

  it('can’t once a slot is on that day again: the undo ran already, or the day was added back', () => {
    const again = state({
      slots: [...after.slots, slot('e', { what: 'Setup', date: '2030-04-06' }, { sortOrder: 0 })],
    });
    expect(planUndo(undo, again)).toBeNull();
  });

  it('can’t once the date field is gone, or no longer a date', () => {
    expect(planUndo(undo, { ...after, fields: [what] })).toBeNull();
    const retyped = field('f_date', 'date', 'Date', 'text', 1);
    expect(planUndo(undo, { ...after, fields: [what, retyped] })).toBeNull();
  });
});

describe('Remove day and its undo', () => {
  it('puts back what it took out, on the signup as Remove day left it', () => {
    const before = state({
      settings: { groupByFieldRefs: ['date'] },
      slots: [
        slot('a', { what: 'Setup', date: '2030-04-06' }, { sortOrder: 0 }),
        slot('b', { what: 'Till', date: '2030-04-13' }, { sortOrder: 1 }),
      ],
    });
    const day = findDayFor(before, removeDayRequest(removableDays(before)[0]!))!;
    const undo = removeDayUndo(day, before);
    const after = state({ settings: before.settings, slots: [before.slots[1]!] });
    expect(planUndo(undo, after)).toEqual({
      kind: 'remove_day',
      rows: [{ values: { what: 'Setup', date: '2030-04-06' }, capacity: 1, sortOrder: 0 }],
      closed: [],
    });
  });
});

// "People for each slot" (#504): every slot's capacity at once.
describe('capacityOffer', () => {
  const two = [slot('a', {}, { capacity: 3 }), slot('b', {}, { capacity: 3 })];

  it('is offered from two slots, starting at the number they all take', () => {
    expect(capacityOffer(two)).toEqual({ fingerprint: slotSetFingerprint(['a', 'b']), shared: 3 });
  });

  it('starts empty when the slots take different numbers, or none has a limit', () => {
    expect(capacityOffer([two[0]!, slot('b', {}, { capacity: 1 })])?.shared).toBeNull();
    expect(capacityOffer([two[0]!, slot('b', {}, { capacity: null })])?.shared).toBeNull();
    const unlimited = [slot('a', {}, { capacity: null }), slot('b', {}, { capacity: null })];
    expect(capacityOffer(unlimited)?.shared).toBeNull();
  });

  it('is not offered for one slot, or more than one call sets', () => {
    expect(capacityOffer([two[0]!])).toBeNull();
    expect(capacityOffer([])).toBeNull();
    const many = Array.from({ length: 501 }, (_, i) => slot(`s${i}`, {}));
    expect(capacityOffer(many)).toBeNull();
    expect(capacityOffer(many.slice(0, 500))).not.toBeNull();
  });
});

describe('findCapacitySlots', () => {
  const now = [slot('a', {}, { capacity: 1 }), slot('b', {}, { capacity: 2 })];
  const request: SetCapacityRequest = {
    kind: 'set_capacity',
    capacity: 4,
    fingerprint: slotSetFingerprint(['b', 'a']),
  };

  it('is every slot, when they are the ones the page showed', () => {
    expect(findCapacitySlots(now, request)).toEqual(['a', 'b']);
    // Whatever they take now: a number set since is set again.
    expect(findCapacitySlots([now[0]!, slot('b', {}, { capacity: 9 })], request)).toEqual([
      'a',
      'b',
    ]);
  });

  it('is nothing once a slot was added or deleted since', () => {
    expect(findCapacitySlots([...now, slot('c', {})], request)).toBeNull();
    expect(findCapacitySlots([now[0]!, slot('c', {})], request)).toBeNull();
    // One slot left: the page wouldn't offer it.
    const one = { ...request, fingerprint: slotSetFingerprint(['a']) };
    expect(findCapacitySlots([now[0]!], one)).toBeNull();
  });
});

describe('planUndo for People for each slot', () => {
  const undo = setCapacityUndo(4, [
    { id: 'a', capacity: 1 },
    { id: 'c', capacity: null },
  ]);
  // Set to 4: a and c changed, b already took 4.
  const after = state({
    slots: [
      slot('a', {}, { capacity: 4 }),
      slot('b', {}, { capacity: 4 }),
      slot('c', {}, { capacity: 4 }),
    ],
  });

  it('puts back each slot it changed, and only those, while each still takes the number set', () => {
    // `expected` has the service check that number again under its locks.
    expect(planUndo(undo, after)).toEqual({
      kind: 'set_capacity',
      slots: [
        { id: 'a', capacity: 1, expected: 4 },
        { id: 'c', capacity: null, expected: 4 },
      ],
    });
    // A slot added since, or one it didn't change taking another number,
    // doesn't stop it, and isn't touched.
    const more = state({
      slots: [
        after.slots[0]!,
        slot('b', {}, { capacity: 7 }),
        after.slots[2]!,
        slot('d', {}, { capacity: 2 }),
      ],
    });
    expect(planUndo(undo, more)).toEqual(planUndo(undo, after));
  });

  it('can’t once a slot it changed takes another number since', () => {
    const edited = state({
      slots: [after.slots[0]!, after.slots[1]!, slot('c', {}, { capacity: 5 })],
    });
    expect(planUndo(undo, edited)).toBeNull();
    const unlimited = state({
      slots: [slot('a', {}, { capacity: null }), after.slots[1]!, after.slots[2]!],
    });
    expect(planUndo(undo, unlimited)).toBeNull();
  });

  it('can’t twice: once undone, no slot it changed takes that number', () => {
    const undone = state({
      slots: [
        slot('a', {}, { capacity: 1 }),
        slot('b', {}, { capacity: 4 }),
        slot('c', {}, { capacity: null }),
      ],
    });
    expect(planUndo(undo, undone)).toBeNull();
  });

  it('can’t once a slot it changed is gone', () => {
    expect(planUndo(undo, state({ slots: after.slots.slice(0, 2) }))).toBeNull();
  });
});

describe('capacitiesRefusal', () => {
  const refused = (code: 'conflict' | 'invalid_input' | 'not_found', field?: string) =>
    serviceError(code, 'service words', field !== undefined ? { field, received: 'x' } : {});
  const reasonOf = (e: { details?: Record<string, unknown> }) => e.details?.reason;

  it('reads a signup no longer a draft as that, for the change and its undo', () => {
    expect(reasonOf(capacitiesRefusal(refused('conflict', 'status'), 'fix'))).toBe('not_draft');
    expect(reasonOf(capacitiesRefusal(refused('conflict', 'status'), 'undo'))).toBe('not_draft');
  });

  it('reads a slot gone, added, changed or taken since as a change: stale, or changed for an undo', () => {
    for (const error of [
      refused('invalid_input', 'slots'),
      refused('conflict', 'slots'),
      refused('conflict', 'capacity'),
    ]) {
      expect(reasonOf(capacitiesRefusal(error, 'fix'))).toBe('stale');
      expect(reasonOf(capacitiesRefusal(error, 'undo'))).toBe('changed');
    }
  });

  it('passes anything else on, without the service’s field', () => {
    expect(capacitiesRefusal(refused('invalid_input', 'slots.0.capacity'), 'fix')).toEqual({
      code: 'invalid_input',
      message: 'service words',
    });
    expect(capacitiesRefusal(refused('not_found'), 'undo')).toEqual({
      code: 'not_found',
      message: 'service words',
    });
  });
});
