import { describe, expect, it } from 'vitest';
import { LOGIN_CODE_MAX_AGE_MS, loginCodeLifetimeMinutes } from './login-code-lifetime';

describe('loginCodeLifetimeMinutes', () => {
  it('caps the code at 15 minutes', () => {
    expect(LOGIN_CODE_MAX_AGE_MS).toBe(15 * 60 * 1000);
  });

  it.each([
    [1, 1],
    [14, 14],
    [15, 15],
    [16, 15],
    [10080, 15],
  ])('a %i minute link gives a %i minute code', (linkMinutes, codeMinutes) => {
    expect(loginCodeLifetimeMinutes(linkMinutes)).toBe(codeMinutes);
  });
});
