import { beforeEach, describe, expect, it, vi } from 'vitest';

let appUrl = 'https://signup.example.org';
vi.mock('./env', () => ({ getEnv: () => ({ NEXT_PUBLIC_APP_URL: appUrl }) }));

const {
  builderPageUrl,
  commitmentLinks,
  draftEmailUnsubscribePostUrl,
  draftEmailUnsubscribeUrl,
  publicSignupUrl,
  reminderUnsubscribePostUrl,
  signupPageUrl,
} = await import('./links');

describe('absolute links', () => {
  beforeEach(() => {
    appUrl = 'https://signup.example.org';
  });

  it('joins the path onto the configured origin', () => {
    expect(publicSignupUrl('bake-sale')).toBe('https://signup.example.org/s/bake-sale');
  });

  it('does not double the slash when the origin ends in one', () => {
    appUrl = 'https://signup.example.org/';
    expect(reminderUnsubscribePostUrl('par_1', 'tok')).toBe(
      'https://signup.example.org/api/public/reminder-optout?p=par_1&token=tok',
    );
  });
});

describe('draft email links', () => {
  beforeEach(() => {
    appUrl = 'https://signup.example.org';
  });

  it('opens the review page and the builder', () => {
    expect(signupPageUrl('sig_1')).toBe('https://signup.example.org/app/signups/sig_1');
    expect(builderPageUrl('sig_1')).toBe('https://signup.example.org/app/signups/sig_1/build');
  });

  it('sends a person to the confirm page and a mail provider to the API route', () => {
    expect(draftEmailUnsubscribeUrl('org_1', 'a+b/c')).toBe(
      'https://signup.example.org/unsubscribe/drafts?o=org_1&token=a%2Bb%2Fc',
    );
    expect(draftEmailUnsubscribePostUrl('org_1', 'tok')).toBe(
      'https://signup.example.org/api/public/draft-email-optout?o=org_1&token=tok',
    );
  });
});

describe('commitmentLinks', () => {
  beforeEach(() => {
    appUrl = 'https://signup.example.org';
  });

  it('builds the edit page URL and the edit, self and cancel links', () => {
    expect(commitmentLinks('bake-sale', 'com_1', 'tok')).toEqual({
      editUrl: 'https://signup.example.org/s/bake-sale/c/com_1?token=tok',
      links: {
        edit: { href: 'https://signup.example.org/s/bake-sale/c/com_1?token=tok', method: 'GET' },
        self: { href: '/api/commitments/com_1?token=tok', method: 'GET' },
        cancel: { href: '/api/commitments/com_1?token=tok', method: 'DELETE' },
      },
    });
  });
});
