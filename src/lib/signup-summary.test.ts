import { describe, expect, it } from 'vitest';
import { renderFieldValue } from '@/lib/slot-label';
import {
  foldPlan,
  hasFilledSlot,
  peopleLabel,
  sharedValues,
  signupHeadline,
  whatHappensOnSignUp,
  type SignupSummaryInput,
  type SummaryField,
} from './signup-summary';

const field = (
  ref: string,
  label: string,
  fieldType: SummaryField['fieldType'],
  sortOrder: number,
): SummaryField => ({ ref, label, fieldType, sortOrder });

const DATE = field('date', 'Date', 'date', 0);
const TIME = field('time', 'Time', 'time', 1);
const TASK = field('task', 'Task', 'text', 2);
const PLACE = field('place', 'Location', 'text', 3);
const FIELDS = [DATE, TIME, TASK, PLACE];

let nextId = 0;
const slot = (values: Record<string, unknown>, capacity: number | null = 1) => ({
  id: `slot_${++nextId}`,
  values,
  capacity,
});

const input = (
  slots: SignupSummaryInput['slots'],
  settings: unknown = {},
  fields: readonly SummaryField[] = FIELDS,
): SignupSummaryInput => ({ fields, slots, settings });

/** 12 slots over three days, four tasks a day, room for three people each. */
function snackRota(): SignupSummaryInput['slots'] {
  const out = [];
  for (const date of ['2026-04-25', '2026-04-26', '2026-04-27']) {
    for (const task of ['Snack duty', 'Setup', 'Cleanup', 'Drinks']) {
      out.push(slot({ date, time: '09:00', task, place: 'Riverside Field' }, 3));
    }
  }
  return out;
}

describe('signupHeadline', () => {
  it('counts slots, days and people in fixed words', () => {
    expect(signupHeadline(input(snackRota()))).toBe('12 slots · 3 days · 3 people each');
  });

  it('says "No slots yet" when there are none', () => {
    expect(signupHeadline(input([]))).toBe('No slots yet');
  });

  it('uses the singular for a single slot on a single day', () => {
    expect(signupHeadline(input([slot({ date: '2026-04-25', task: 'Snack duty' }, 1)]))).toBe(
      '1 slot · 1 day · 1 person each',
    );
  });

  it('leaves the days out when the signup has no date field', () => {
    const fields = [TASK, PLACE];
    const slots = [slot({ task: 'Snack duty' }, 2), slot({ task: 'Setup' }, 2)];
    expect(signupHeadline(input(slots, {}, fields))).toBe('2 slots · 2 people each');
  });

  it('leaves the days out when no slot has a date yet', () => {
    const slots = [slot({ task: 'Snack duty', date: '' }, 2), slot({ task: 'Setup' }, 2)];
    expect(signupHeadline(input(slots))).toBe('2 slots · 2 people each');
  });

  it('counts each distinct date once and skips slots with no date', () => {
    const slots = [
      slot({ date: '2026-04-25' }),
      slot({ date: '2026-04-25' }),
      slot({ date: '2026-04-26' }),
      slot({ date: '' }),
      slot({ date: null }),
      slot({}),
    ];
    expect(signupHeadline(input(slots))).toBe('6 slots · 2 days · 1 person each');
  });

  describe('which date field it counts', () => {
    const start = field('start', 'Start', 'date', 0);
    const end = field('end', 'End', 'date', 1);
    // Two starts, three ends: the count says which field was read.
    const slots = [
      slot({ start: '2026-04-25', end: '2026-04-25', task: 'Setup' }),
      slot({ start: '2026-04-25', end: '2026-04-26', task: 'Setup' }),
      slot({ start: '2026-04-26', end: '2026-04-27', task: 'Setup' }),
    ];

    it('uses the date field reminderFromFieldRef names', () => {
      const out = signupHeadline(input(slots, { reminderFromFieldRef: 'end' }, [start, end, TASK]));
      expect(out).toBe('3 slots · 3 days · 1 person each');
    });

    it('falls back to the first date field by sortOrder when none is named', () => {
      // Array order puts `end` first; sortOrder puts `start` first.
      const out = signupHeadline(input(slots, {}, [end, start, TASK]));
      expect(out).toBe('3 slots · 2 days · 1 person each');
    });

    it('falls back when reminderFromFieldRef names a field that is not a date', () => {
      const out = signupHeadline(input(slots, { reminderFromFieldRef: 'task' }, [start, end, TASK]));
      expect(out).toBe('3 slots · 2 days · 1 person each');
    });
  });

  describe('capacity phrase', () => {
    const withCapacities = (...caps: (number | null)[]) =>
      signupHeadline(input(caps.map((c) => slot({ task: 'Snack duty' }, c)), {}, [TASK]));

    it('names the one number when every slot takes the same', () => {
      expect(withCapacities(1, 1)).toBe('2 slots · 1 person each');
      expect(withCapacities(3, 3, 3)).toBe('3 slots · 3 people each');
    });

    it('gives the range when slots take different numbers', () => {
      expect(withCapacities(1, 4, 2)).toBe('3 slots · 1 to 4 people each');
    });

    it('says "no limit on people" when no slot has a limit', () => {
      expect(withCapacities(null, null)).toBe('2 slots · no limit on people');
      expect(withCapacities(null)).toBe('1 slot · no limit on people');
    });

    it('adds "some with no limit" when only some slots are unlimited', () => {
      expect(withCapacities(1, null, 4)).toBe('3 slots · 1 to 4 people each, some with no limit');
      expect(withCapacities(3, null, 3)).toBe('3 slots · 3 people each, some with no limit');
      expect(withCapacities(null, 1)).toBe('2 slots · 1 person each, some with no limit');
    });
  });

  it('never borrows a word from a field label', () => {
    // An organizer writing in Spanish: the headline stays in its fixed words
    // rather than saying "2 Turnos" or "2 Fechas".
    const fields = [
      field('fecha', 'Fecha', 'date', 0),
      field('turno', 'Turno', 'text', 1),
      field('lugar', 'Lugar', 'text', 2),
    ];
    const slots = [
      slot({ fecha: '2026-04-25', turno: 'Mañana', lugar: 'Parque' }, 2),
      slot({ fecha: '2026-04-26', turno: 'Tarde', lugar: 'Parque' }, null),
    ];
    const headline = signupHeadline(input(slots, { reminderFromFieldRef: 'fecha' }, fields));
    expect(headline).toBe('2 slots · 2 days · 2 people each, some with no limit');
    for (const f of fields) expect(headline).not.toContain(f.label);
  });

  it('reads settings that are missing or malformed as no settings', () => {
    const slots = [slot({ date: '2026-04-25' }, 2)];
    for (const settings of [null, undefined, 'nope', { reminderFromFieldRef: 7 }]) {
      expect(signupHeadline(input(slots, settings))).toBe('1 slot · 1 day · 2 people each');
    }
  });
});

describe('sharedValues', () => {
  it('returns each field every slot has the same value for, rendered, in field order', () => {
    expect(sharedValues(input(snackRota()))).toEqual([
      { ref: 'time', text: '9:00 AM' },
      { ref: 'place', text: 'Riverside Field' },
    ]);
  });

  it('renders date and time values exactly as renderFieldValue does', () => {
    const slots = [
      slot({ date: '2026-04-25', time: '18:30', task: 'Snack duty' }),
      slot({ date: '2026-04-25', time: '18:30', task: 'Setup' }),
    ];
    const shared = sharedValues(input(slots));
    expect(shared).toEqual([
      { ref: 'date', text: renderFieldValue(DATE, '2026-04-25') },
      { ref: 'time', text: renderFieldValue(TIME, '18:30') },
    ]);
    expect(shared.map((s) => s.text)).toEqual(['Sat, Apr 25', '6:30 PM']);
  });

  it('works on an ungrouped signup', () => {
    const slots = [
      slot({ task: 'Snack duty', place: 'Riverside Field' }),
      slot({ task: 'Setup', place: 'Riverside Field' }),
    ];
    expect(sharedValues(input(slots, {}, [TASK, PLACE]))).toEqual([
      { ref: 'place', text: 'Riverside Field' },
    ]);
  });

  it('leaves out the group field even when every slot shares it', () => {
    const slots = [
      slot({ date: '2026-04-25', time: '09:00', task: 'Snack duty' }),
      slot({ date: '2026-04-25', time: '09:00', task: 'Setup' }),
    ];
    expect(sharedValues(input(slots, { groupByFieldRefs: ['date'] }))).toEqual([
      { ref: 'time', text: '9:00 AM' },
    ]);
  });

  it('does not count a field that is empty on some slots as shared', () => {
    const slots = [
      slot({ task: 'Snack duty', place: 'Riverside Field' }),
      slot({ task: 'Snack duty', place: '' }),
      slot({ task: 'Snack duty' }),
      slot({ task: 'Snack duty', place: null }),
    ];
    expect(sharedValues(input(slots, {}, [TASK, PLACE]))).toEqual([
      { ref: 'task', text: 'Snack duty' },
    ]);
  });

  it('does not count a field that is empty on every slot as shared', () => {
    const slots = [slot({ task: 'Snack duty' }), slot({ task: 'Setup', place: '' })];
    expect(sharedValues(input(slots, {}, [TASK, PLACE]))).toEqual([]);
  });

  it('compares values by their rendered text', () => {
    const count = field('count', 'Count', 'number', 0);
    const slots = [slot({ count: 3 }), slot({ count: '3' })];
    expect(sharedValues(input(slots, {}, [count]))).toEqual([{ ref: 'count', text: '3' }]);
  });

  it('says nothing for a single slot or none, where "every slot" means little', () => {
    expect(sharedValues(input([slot({ task: 'Snack duty', place: 'Riverside Field' })]))).toEqual(
      [],
    );
    expect(sharedValues(input([]))).toEqual([]);
  });
});

describe('foldPlan', () => {
  const sizes = (...ns: number[]) => ns.map((size, i) => ({ key: `g${i}`, size }));

  it('shows all of an ungrouped list of 3', () => {
    expect(foldPlan([{ key: '__all__', size: 3 }], false)).toEqual({
      groups: [{ key: '__all__', open: true, visible: 3, hidden: 0 }],
      hiddenCount: 0,
      total: 3,
    });
  });

  it('shows the first six of an ungrouped list of 10', () => {
    expect(foldPlan([{ key: '__all__', size: 10 }], false)).toEqual({
      groups: [{ key: '__all__', open: true, visible: 6, hidden: 4 }],
      hiddenCount: 4,
      total: 10,
    });
  });

  it('hides nothing when an ungrouped list is exactly the limit', () => {
    expect(foldPlan([{ key: '__all__', size: 6 }], false).hiddenCount).toBe(0);
  });

  it('opens only the first of 3 groups when it has 2 rows', () => {
    expect(foldPlan(sizes(2, 3, 4), true)).toEqual({
      groups: [
        { key: 'g0', open: true, visible: 2, hidden: 0 },
        { key: 'g1', open: false, visible: 0, hidden: 3 },
        { key: 'g2', open: false, visible: 0, hidden: 4 },
      ],
      hiddenCount: 7,
      total: 9,
    });
  });

  it('caps the open first group at six rows when it has 9', () => {
    expect(foldPlan(sizes(9, 2, 1), true)).toEqual({
      groups: [
        { key: 'g0', open: true, visible: 6, hidden: 3 },
        { key: 'g1', open: false, visible: 0, hidden: 2 },
        { key: 'g2', open: false, visible: 0, hidden: 1 },
      ],
      hiddenCount: 6,
      total: 12,
    });
  });

  it('treats a grouped signup whose slots all share one group like any first group', () => {
    expect(foldPlan(sizes(8), true)).toEqual({
      groups: [{ key: 'g0', open: true, visible: 6, hidden: 2 }],
      hiddenCount: 2,
      total: 8,
    });
  });

  it('takes a different limit', () => {
    expect(foldPlan([{ key: '__all__', size: 3 }], false, 2)).toEqual({
      groups: [{ key: '__all__', open: true, visible: 2, hidden: 1 }],
      hiddenCount: 1,
      total: 3,
    });
  });

  it('reads several groups passed as ungrouped as one list', () => {
    expect(foldPlan(sizes(4, 4), false)).toEqual({
      groups: [
        { key: 'g0', open: true, visible: 4, hidden: 0 },
        { key: 'g1', open: true, visible: 2, hidden: 2 },
      ],
      hiddenCount: 2,
      total: 8,
    });
  });

  it('hides nothing when there are no slots', () => {
    expect(foldPlan([], true)).toEqual({ groups: [], hiddenCount: 0, total: 0 });
    expect(foldPlan([{ key: '__all__', size: 0 }], false)).toEqual({
      groups: [{ key: '__all__', open: true, visible: 0, hidden: 0 }],
      hiddenCount: 0,
      total: 0,
    });
  });
});

describe('peopleLabel', () => {
  it('counts people in the singular and plural', () => {
    expect(peopleLabel(1)).toBe('1 person');
    expect(peopleLabel(3)).toBe('3 people');
    expect(peopleLabel(12)).toBe('12 people');
  });

  it('says "No limit" for a slot without one', () => {
    expect(peopleLabel(null)).toBe('No limit');
  });
});

describe('hasFilledSlot', () => {
  const what = { ref: 'what', label: 'What', fieldType: 'text' as const, sortOrder: 0 };
  const date = { ref: 'date', label: 'Date', fieldType: 'date' as const, sortOrder: 1 };

  it('is false for the blank template’s empty row', () => {
    expect(hasFilledSlot({ fields: [what, date], slots: [{ id: 's1', values: {}, capacity: 1 }] })).toBe(false);
  });

  it('is false with no slots, and for values that are only blank', () => {
    expect(hasFilledSlot({ fields: [what], slots: [] })).toBe(false);
    expect(
      hasFilledSlot({ fields: [what], slots: [{ id: 's1', values: { what: '' }, capacity: 1 }] }),
    ).toBe(false);
  });

  it('is true once any slot has a value in any field', () => {
    expect(
      hasFilledSlot({
        fields: [what, date],
        slots: [
          { id: 's1', values: {}, capacity: 1 },
          { id: 's2', values: { date: '2030-04-06' }, capacity: 1 },
        ],
      }),
    ).toBe(true);
  });

  it('ignores a value under a ref the signup has no field for', () => {
    expect(
      hasFilledSlot({ fields: [what], slots: [{ id: 's1', values: { gone: 'x' }, capacity: 1 }] }),
    ).toBe(false);
  });
});

describe('whatHappensOnSignUp', () => {
  const before = 'the day before';

  it('promises a reminder only when one will go out', () => {
    expect(whatHappensOnSignUp({ requireEmail: true, reminders: true, before })).toBe(
      'They give their name and email, and get a confirmation email now and a reminder the day before their slot.',
    );
    expect(whatHappensOnSignUp({ requireEmail: true, reminders: false, before })).toBe(
      'They give their name and email, and get a confirmation email. No reminder emails.',
    );
  });

  it('says email is optional, and who gets emails then', () => {
    expect(whatHappensOnSignUp({ requireEmail: false, reminders: true, before })).toBe(
      'They give their name. Email is optional: people who add one get a confirmation, and a reminder the day before their slot.',
    );
    expect(whatHappensOnSignUp({ requireEmail: false, reminders: false, before })).toBe(
      'They give their name. Email is optional: people who add one get a confirmation. No reminder emails.',
    );
  });
});
