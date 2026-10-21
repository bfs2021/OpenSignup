import { describe, expect, it } from 'vitest';
import { serviceError } from '@/lib/errors';
import { fixRefusal } from './fix-refusal';

const reason = (r: string) => ({ details: { reason: r } });

describe('fixRefusal', () => {
  it('says a fix found the problem gone, and that nothing was done', () => {
    expect(fixRefusal(serviceError('conflict', 'x', reason('stale')), 'fix')).toBe(
      'That changed since you opened this page, so nothing was done.',
    );
  });

  it('says an undo found things changed again', () => {
    expect(fixRefusal(serviceError('conflict', 'x', reason('changed')), 'undo')).toBe(
      'That changed again since, so it can’t be undone.',
    );
    // A field of that name added back meanwhile.
    expect(fixRefusal(serviceError('conflict', 'field ref "notes" already exists'), 'undo')).toBe(
      'That changed again since, so it can’t be undone.',
    );
  });

  it('says an undo the services refused for its input couldn’t be done, not that things changed', () => {
    expect(fixRefusal(serviceError('invalid_input', 'unknown field ref "x"'), 'undo')).toBe(
      'Couldn’t undo that. Change it in the builder.',
    );
    // Even on a field called "label": only a fix takes a name.
    expect(
      fixRefusal(
        serviceError('invalid_input', 'x', { field: 'label', ...reason('blank') }),
        'undo',
      ),
    ).toBe('Couldn’t undo that. Change it in the builder.');
  });

  it('says a fix the services won’t take as asked couldn’t be done, not to reload', () => {
    expect(fixRefusal(serviceError('invalid_input', 'values do not fit the fields'), 'fix')).toBe(
      'Couldn’t fix that. Try again.',
    );
  });

  it('sends a signup that is no longer a draft to the builder', () => {
    for (const step of ['fix', 'undo'] as const) {
      expect(fixRefusal(serviceError('conflict', 'x', reason('not_draft')), step)).toBe(
        'This signup isn’t a draft any more. Change it in the builder.',
      );
    }
  });

  it('says what is wrong with a field’s new name', () => {
    const label = (r: string) =>
      serviceError('invalid_input', 'x', { field: 'label', ...reason(r) });
    expect(fixRefusal(label('blank'), 'fix')).toBe('Type a name for the field.');
    expect(fixRefusal(label('untitled'), 'fix')).toBe('Give it a name other than “Untitled”.');
    expect(fixRefusal(label('too_long'), 'fix')).toBe('The name can be up to 80 letters.');
  });

  it('says a viewer cannot edit, in the words Save uses', () => {
    expect(
      fixRefusal(serviceError('forbidden', 'your role cannot modify this workspace'), 'fix'),
    ).toBe('You don’t have edit access.');
    expect(fixRefusal(serviceError('not_found', 'signup not found'), 'undo')).toBe(
      'No longer available.',
    );
  });

  it('falls back by step, never with the service’s own words', () => {
    expect(fixRefusal(serviceError('internal', 'boom'), 'fix')).toBe(
      'Couldn’t fix that. Try again.',
    );
    expect(fixRefusal(serviceError('internal', 'boom'), 'undo')).toBe(
      'Couldn’t undo that. Try again.',
    );
  });
});
