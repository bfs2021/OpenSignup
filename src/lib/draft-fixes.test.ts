import { describe, expect, it } from 'vitest';
import type { DraftFixUndo } from '@/schemas/draft-fixes';
import type { SlotFieldDefinition } from '@/schemas/slot-fields';
import { checkDraft, type DraftNotice, type DraftNoticeOf } from './draft-checks';
import {
  buildUndo,
  draftInputOf,
  findNoticeFor,
  fixRequestFor,
  labelProblem,
  planUndo,
  restoredLabel,
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
  });

  it('has none for a field with no name (it takes a name) or a kind with no fix', () => {
    expect(fixRequestFor({ kind: 'unnamed_field', fieldId: 'f' })).toBeNull();
    expect(fixRequestFor({ kind: 'placeholder', slotIds: ['a'], word: 'TBD' })).toBeNull();
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
      settings: { reminderFromFieldRef: 'date', groupByFieldRefs: ['date'] },
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
      settings: { reminderFromFieldRef: 'date', groupByFieldRefs: ['date'] },
    };
    expect(planUndo(removedDate, state({ fields: [what], settings: {} }))).toMatchObject({
      settings: { reminderFromFieldRef: 'date', groupByFieldRefs: ['date'] },
    });
    expect(
      planUndo(removedDate, state({ fields: [what], settings: { groupByFieldRefs: ['what'] } })),
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
