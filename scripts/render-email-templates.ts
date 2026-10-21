/**
 * Renders each sendable email template and exits non-zero if any of them
 * throws. Shared pieces under src/email/templates (layout.tsx) are covered
 * transitively, since every sendable template composes them; add a case here
 * whenever a new template gains a `send*` function.
 *
 * Exists to be run under the *worker's* toolchain (`tsx --tsconfig
 * tsconfig.worker.json`), which is the only place templates are compiled
 * outside Next.js. See src/email/templates/worker-render.test.ts for why that
 * distinction matters.
 */
import { createElement, type ReactElement } from 'react';
import { renderEmail } from '@/email/render';
import { CommitmentConfirmationEmail } from '@/email/templates/commitment-confirmation';
import { DraftNudgeEmail } from '@/email/templates/draft-nudge';
import { MagicLinkEmail } from '@/email/templates/magic-link';
import { ReminderEmail } from '@/email/templates/reminder';

const cases: Array<[string, ReactElement]> = [
  [
    'magic-link',
    createElement(MagicLinkEmail, {
      url: 'https://example.test/login/confirm?token=abc',
      email: 'organizer@example.test',
      expiresInMinutes: 60,
    }),
  ],
  [
    'commitment-confirmation',
    createElement(CommitmentConfirmationEmail, {
      participantName: 'Dana',
      signupTitle: 'Saturday Snack Rotation',
      manageUrl: 'https://example.test/s/snacks/c/com_1?token=abc',
      slotDetails: [
        { label: 'Date', value: 'Sat, Sep 5' },
        { label: 'Time', value: '09:00' },
        { label: 'Snack', value: 'Fruit' },
      ],
      slotSummary: 'Sat, Sep 5 · 09:00 · Fruit',
      notes: 'Bringing grapes',
      quantity: 2,
      promisesReminder: true,
    }),
  ],
  [
    'reminder',
    createElement(ReminderEmail, {
      participantName: 'Dana',
      signupTitle: 'Saturday Snack Rotation',
      manageUrl: 'https://example.test/s/snacks/c/com_1?token=abc',
      unsubscribeUrl: 'https://example.test/s/snacks/unsubscribe?p=par_1&token=abc',
      slotDetails: [
        { label: 'Date', value: 'Sat, Sep 5' },
        { label: 'Snack', value: 'Fruit' },
      ],
      slotSummary: 'Sat, Sep 5 · Fruit',
      notes: 'Bringing grapes',
    }),
  ],
  [
    'draft-nudge',
    createElement(DraftNudgeEmail, {
      signupTitle: 'Saturday Snack Rotation',
      headline: '12 slots · 3 days · 3 people each',
      reviewUrl: 'https://example.test/app/signups/sig_1',
      builderUrl: 'https://example.test/app/signups/sig_1/build',
      unsubscribeUrl: 'https://example.test/unsubscribe/drafts?o=org_1&token=abc',
      requested: false,
    }),
  ],
];

/**
 * Distinctive strings each template must put in its output. Asserting on real
 * rendered content rather than "not empty" is what makes the guard notice a
 * template that renders but drops a section — e.g. after gaining a prop the
 * fixture above does not supply.
 */
const expected: Record<string, string[]> = {
  'magic-link': ['https://example.test/login/confirm?token=abc'],
  'commitment-confirmation': ['https://example.test/s/snacks/c/com_1?token=abc'],
  reminder: ['Sat, Sep 5'],
  // The "So far" headline, the button, and the opt-out link.
  'draft-nudge': ['3 days', 'Check it and publish', 'Stop emails about unpublished drafts'],
};

async function main(): Promise<void> {
  for (const [name, node] of cases) {
    const { html, text } = await renderEmail(node);
    if (!html.trim() || !text.trim()) {
      throw new Error(`${name} rendered empty output`);
    }
    const needles = expected[name];
    if (needles === undefined) {
      throw new Error(`${name} has no expected-content entry; add one`);
    }
    for (const [format, body] of [
      ['html', html],
      ['text', text],
    ] as const) {
      for (const needle of needles) {
        if (!body.includes(needle)) {
          throw new Error(`${name} ${format} output is missing ${JSON.stringify(needle)}`);
        }
      }
    }
    console.log(`ok ${name}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
