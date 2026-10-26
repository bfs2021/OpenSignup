import { describe, expect, it } from 'vitest';
import { placeholderMark, slotActionLabels, slotRowLabel, takenText } from './slotRow';

const fields = [{ ref: 'time' }, { ref: 'job' }, { ref: 'where' }];

describe('placeholderMark', () => {
  it('says what a draft’s slot still says, with the word in capitals', () => {
    expect(placeholderMark({ time: '13:00', job: 'tbd' }, fields, 'draft')).toBe(
      'Still says “TBD”',
    );
    expect(placeholderMark({ job: 'Cashier (TBC)' }, fields, 'draft')).toBe('Still says “TBC”');
  });

  it('says people can see it once the page is open, or closed', () => {
    expect(placeholderMark({ job: 'TBA' }, fields, 'open')).toBe('People can see “TBA”');
    expect(placeholderMark({ job: 'TBA' }, fields, 'closed')).toBe('People can see “TBA”');
  });

  it('says what it still says on an archived signup, whose page shows people none of it', () => {
    expect(placeholderMark({ job: 'TBD' }, fields, 'archived')).toBe('Still says “TBD”');
  });

  it('names the first word in the fields’ order, not the values’', () => {
    expect(placeholderMark({ where: 'Room TBA', job: 'TBD' }, fields, 'draft')).toBe(
      'Still says “TBD”',
    );
  });

  it('marks nothing without one, by the check’s own test', () => {
    expect(placeholderMark({ time: '13:00', job: 'Cashier' }, fields, 'draft')).toBeNull();
    // Near-misses, as in Publish's check, and a value under no field of the signup.
    for (const job of ['TBDX', 'Tbacco', 'ÉTBA', 'TBD1', 'to be decided']) {
      expect(placeholderMark({ job }, fields, 'draft')).toBeNull();
    }
    expect(placeholderMark({ notes: 'TBD' }, fields, 'draft')).toBeNull();
    expect(placeholderMark({}, [], 'draft')).toBeNull();
  });
});

describe('slotRowLabel', () => {
  const none = { anchor: '', time: false, prompt: null, mark: null, count: '0 of 6 taken' };

  it('names the row by its first field, then the spots taken', () => {
    expect(slotRowLabel({ ...none, anchor: 'Surfing' })).toBe('Edit slot — Surfing, 0 of 6 taken');
    expect(slotRowLabel({ ...none, anchor: '9:00\u00a0AM', time: true })).toBe(
      'Edit slot at 9:00\u00a0AM, 0 of 6 taken',
    );
    expect(slotRowLabel({ ...none, prompt: 'Set a date' })).toBe(
      'Edit slot — Set a date, 0 of 6 taken',
    );
    expect(slotRowLabel({ ...none, count: '2 taken' })).toBe('Edit slot, 2 taken');
  });

  it('says the tag before the count, as the row shows them', () => {
    expect(
      slotRowLabel({ ...none, anchor: '1:00\u00a0PM', time: true, mark: 'Still says “TBD”' }),
    ).toBe('Edit slot at 1:00\u00a0PM, still says “TBD”, 0 of 6 taken');
    expect(
      slotRowLabel({ ...none, anchor: 'Cashier TBD', mark: 'People can see “TBD”' }),
    ).toBe('Edit slot — Cashier TBD, people can see “TBD”, 0 of 6 taken');
    expect(slotRowLabel({ ...none, prompt: 'Set what', mark: 'Still says “TBA”' })).toBe(
      'Edit slot — Set what, still says “TBA”, 0 of 6 taken',
    );
  });
});

describe('slotActionLabels', () => {
  it('names the toolbar and the open editor for the slot, as the row is named', () => {
    expect(slotActionLabels({ anchor: 'Cupcakes', time: false, prompt: null })).toEqual({
      edit: 'Edit slot — Cupcakes',
      duplicate: 'Duplicate slot — Cupcakes',
      delete: 'Delete slot — Cupcakes',
      editing: 'Editing slot — Cupcakes',
    });
    expect(slotActionLabels({ anchor: '9:00\u00a0AM', time: true, prompt: null }).delete).toBe(
      'Delete slot at 9:00\u00a0AM',
    );
    expect(slotActionLabels({ anchor: '', time: false, prompt: 'Set a date' }).delete).toBe(
      'Delete slot — Set a date',
    );
    expect(slotActionLabels({ anchor: '', time: false, prompt: null }).duplicate).toBe(
      'Duplicate slot',
    );
  });
});

describe('takenText', () => {
  it('counts the spots taken, out of the limit when there is one', () => {
    expect(takenText(0, 6)).toBe('0 of 6 taken');
    expect(takenText(2, null)).toBe('2 taken');
  });
});
