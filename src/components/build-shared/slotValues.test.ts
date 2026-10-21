import { describe, expect, it } from 'vitest';
import { slotPatch, toSlotValues, toStringValues } from './slotValues';

const FIELDS = [
  { ref: 'what', config: { fieldType: 'text' } },
  { ref: 'date', config: { fieldType: 'date' } },
  { ref: 'qty', config: { fieldType: 'number' } },
];

describe('toStringValues', () => {
  it('shows every stored value as text, and null or missing as empty', () => {
    expect(toStringValues({ what: 'Fruit', qty: 3, date: null, notes: undefined })).toEqual({
      what: 'Fruit',
      qty: '3',
      date: '',
      notes: '',
    });
  });
});

describe('toSlotValues', () => {
  it('sends a number field as a number and leaves the others as typed', () => {
    expect(toSlotValues({ what: '12', date: '2030-04-06', qty: '12' }, FIELDS)).toEqual({
      what: '12',
      date: '2030-04-06',
      qty: 12,
    });
  });

  it('leaves out a number field that is empty or not a number', () => {
    expect(toSlotValues({ qty: '' }, FIELDS)).toEqual({});
    expect(toSlotValues({ qty: 'abc' }, FIELDS)).toEqual({});
  });

  it('keeps an empty text value, which clears it', () => {
    expect(toSlotValues({ what: '' }, FIELDS)).toEqual({ what: '' });
  });
});

describe('slotPatch', () => {
  const stored = { values: { what: 'Fruit and water', date: '2030-04-06', qty: 2 }, capacity: 2 };

  it('is null when nothing changed', () => {
    expect(slotPatch(stored, { values: {} }, FIELDS)).toBeNull();
  });

  it('is null when a value was changed and changed back', () => {
    expect(slotPatch(stored, { values: { what: 'Fruit and water', qty: '2' } }, FIELDS)).toBeNull();
  });

  it('is null when the capacity is set to what it was', () => {
    expect(slotPatch(stored, { values: {}, capacity: 2 }, FIELDS)).toBeNull();
  });

  it('sends only the capacity when only the capacity changed', () => {
    expect(slotPatch(stored, { values: {}, capacity: 4 }, FIELDS)).toEqual({ capacity: 4 });
  });

  it('sends no limit as null', () => {
    expect(slotPatch(stored, { values: {}, capacity: null }, FIELDS)).toEqual({ capacity: null });
  });

  it('sends every value when one changed, the stored ones under the draft', () => {
    expect(slotPatch(stored, { values: { what: 'Juice' } }, FIELDS)).toEqual({
      values: { what: 'Juice', date: '2030-04-06', qty: 2 },
    });
  });

  it('sends a value for a field the slot had none for', () => {
    expect(
      slotPatch({ values: {}, capacity: null }, { values: { what: 'Juice' } }, FIELDS),
    ).toEqual({ values: { what: 'Juice' } });
  });

  it('sends values and capacity together when both changed', () => {
    expect(slotPatch(stored, { values: { qty: '5' }, capacity: null }, FIELDS)).toEqual({
      values: { what: 'Fruit and water', date: '2030-04-06', qty: 5 },
      capacity: null,
    });
  });
});
