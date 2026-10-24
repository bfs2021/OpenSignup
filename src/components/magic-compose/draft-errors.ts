import { MAGIC_COMPOSE_BUCKET } from '@/lib/magic-compose/limits';

/** The `error` of the API's envelope, as far as the drafting screen reads it. */
export interface DraftErrorBody {
  code?: string;
  message?: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}

/**
 * What a failed draft tells the organizer. The hourly limit is its own kind
 * because its message carries a link to the manual form.
 */
export type DraftError =
  | { kind: 'message'; text: string }
  | { kind: 'hourly_limit'; minutes: number };

const PROVIDER_BUSY = 'The AI service is busy. Try again in a minute.';

/**
 * Words a failed draft request for the organizer. Both rate limits are worded
 * here rather than on the server: `consumeRateLimit` is shared by every
 * endpoint, so its "too many requests" and "wait Ns and retry" stay as they
 * are, and only this screen knows the bucket means "this hour's AI drafts".
 * A provider's own 429 has no bucket.
 */
export function explainDraftFailure(status: number, error: DraftErrorBody | undefined): DraftError {
  if (error?.code === 'rate_limited') {
    const bucket = error.details?.bucket;
    if (bucket === MAGIC_COMPOSE_BUCKET) {
      const wait = error.details?.retryAfterSeconds;
      const seconds = typeof wait === 'number' && wait > 0 ? wait : 3600;
      return { kind: 'hourly_limit', minutes: Math.ceil(seconds / 60) };
    }
    if (bucket === undefined) return { kind: 'message', text: PROVIDER_BUSY };
  }
  const base = error?.message ?? `AI drafting failed (HTTP ${status}). Try again.`;
  return { kind: 'message', text: error?.suggestion ? `${base} — ${error.suggestion}` : base };
}
