import { SAVE_ERROR_MESSAGE } from '@/components/ui/save-notice';
import type { ServiceError } from '@/lib/errors';
import { LABEL_MAX_LENGTH } from '@/schemas/slot-fields';

/**
 * What an organizer reads when a one-tap fix on the review page, or its Undo,
 * is refused, in place of the service's message, which is written for
 * developers. `details.reason` says why a fix or an undo met a signup that
 * had changed (`src/services/draft-fixes.ts`).
 */
export function fixRefusal(error: ServiceError, step: 'fix' | 'undo'): string {
  const reason = error.details?.reason;
  if (reason === 'not_draft') {
    return 'This signup isn’t a draft any more. Change it in the builder.';
  }
  if (error.code === 'invalid_input' && error.field === 'label') {
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
      // A fix finds the problem gone; an undo finds what it would put back
      // already changed, or no longer accepted.
      if (step === 'undo') {
        return error.code === 'conflict'
          ? 'That changed again since, so it can’t be undone.'
          : 'Couldn’t undo that. Change it in the builder.';
      }
      if (reason === 'stale') {
        return 'That changed since you opened this page, so nothing was done.';
      }
      return SAVE_ERROR_MESSAGE.conflict;
    default:
      return step === 'fix' ? 'Couldn’t fix that. Try again.' : 'Couldn’t undo that. Try again.';
  }
}
