import { describe, expect, it } from 'vitest';
import { MAGIC_COMPOSE_BUCKET } from '@/lib/magic-compose/limits';
import { RateLimits } from '@/lib/rate-limit';
import { explainDraftFailure } from './draft-errors';

const hourly = (retryAfterSeconds?: number) => ({
  code: 'rate_limited',
  message: 'too many requests',
  suggestion: `wait ${retryAfterSeconds}s and retry`,
  details: {
    bucket: MAGIC_COMPOSE_BUCKET,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  },
});

describe('explainDraftFailure', () => {
  it('names the bucket the route charges', () => {
    expect(RateLimits.magicComposePerOrganizer.bucket).toBe(MAGIC_COMPOSE_BUCKET);
  });

  it('turns the hourly limit into whole minutes, rounded up', () => {
    expect(explainDraftFailure(429, hourly(700))).toEqual({ kind: 'hourly_limit', minutes: 12 });
    expect(explainDraftFailure(429, hourly(60))).toEqual({ kind: 'hourly_limit', minutes: 1 });
    expect(explainDraftFailure(429, hourly(1))).toEqual({ kind: 'hourly_limit', minutes: 1 });
  });

  it('assumes the whole window when the wait is missing', () => {
    expect(explainDraftFailure(429, hourly())).toEqual({ kind: 'hourly_limit', minutes: 60 });
  });

  it("words the provider's own 429, which has no bucket, as a busy service", () => {
    const error = {
      code: 'rate_limited',
      message: 'AI provider is rate limiting requests. Try again in 30s.',
      details: { llmErrorCode: 'rate_limited', retryAfterSeconds: 30 },
    };
    expect(explainDraftFailure(429, error)).toEqual({
      kind: 'message',
      text: 'The AI service is busy. Try again in a minute.',
    });
  });

  it('keeps the server message and its suggestion for other errors', () => {
    const error = {
      code: 'internal',
      message: 'AI draft did not match expected shape',
      suggestion: 'try again or adjust your prompt',
    };
    expect(explainDraftFailure(500, error)).toEqual({
      kind: 'message',
      text: 'AI draft did not match expected shape — try again or adjust your prompt',
    });
  });

  it('falls back to the status when there is no error body', () => {
    expect(explainDraftFailure(502, undefined)).toEqual({
      kind: 'message',
      text: 'AI drafting failed (HTTP 502). Try again.',
    });
  });
});
