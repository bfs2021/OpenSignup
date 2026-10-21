import { SAVE_ERROR_MESSAGE } from '@/components/ui/save-notice';
import type { ServiceError } from '@/lib/errors';
import { LABEL_MAX_LENGTH } from '@/schemas/slot-fields';

/**
 * A change on the review page: a one-tap fix, Remove day, "People for each
 * slot" (`set_capacity`), or Undo for any of them.
 */
export type FixStep = 'fix' | 'remove_day' | 'set_capacity' | 'undo';

/** What a change that failed for no reason to act on says: try again. */
const FAILED: Record<FixStep, string> = {
  fix: 'Couldn’t fix that. Try again.',
  remove_day: 'Couldn’t remove that day. Try again.',
  set_capacity: 'Couldn’t set that. Try again.',
  undo: 'Couldn’t undo that. Try again.',
};

/**
 * What an organizer reads when a one-tap fix on the review page, Remove day,
 * "People for each slot", or Undo for any of them is refused, in place of the
 * service's message, which is written for developers. `details.reason` says
 * why a change or an undo met a signup that had changed
 * (`src/services/draft-fixes.ts`). Remove day and "People for each slot" read
 * as a fix does, but for their own words when they fail, and the number of
 * people for the latter.
 */
export function fixRefusal(error: ServiceError, step: FixStep): string {
  const reason = error.details?.reason;
  if (reason === 'not_draft') {
    return 'This signup isn’t a draft any more. Change it in the builder.';
  }
  if (step === 'set_capacity' && error.code === 'invalid_input' && error.field === 'capacity') {
    return 'Type a whole number of people, 1 or more.';
  }
  // Only a fix takes a name: an undo's refusal on a field called "label" is
  // not about the rename box.
  if (step === 'fix' && error.code === 'invalid_input' && error.field === 'label') {
    if (reason === 'untitled') return 'Give it a name other than “Untitled”.';
    if (reason === 'too_long') return `The name can be up to ${LABEL_MAX_LENGTH} letters.`;
    return 'Type a name for the field.';
  }
  switch (error.code) {
    case 'forbidden':
    case 'unauthorized':
    case 'not_found':
      return SAVE_ERROR_MESSAGE[error.code];
    case 'conflict':
    case 'invalid_input':
      // A fix finds the problem gone, Remove day the day changed, "People
      // for each slot" the slots changed; an undo finds what it would put
      // back already changed, or no longer accepted.
      if (step === 'undo') {
        return error.code === 'conflict'
          ? 'That changed again since, so it can’t be undone.'
          : 'Couldn’t undo that. Change it in the builder.';
      }
      if (reason === 'stale') {
        return 'That changed since you opened this page, so nothing was done.';
      }
      // A fix the services won't take as asked: not a change to reload for.
      return error.code === 'conflict' ? SAVE_ERROR_MESSAGE.conflict : FAILED[step];
    default:
      return FAILED[step];
  }
}
