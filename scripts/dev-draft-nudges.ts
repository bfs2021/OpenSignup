/**
 * Draft-email inspector / kicker for local development, like
 * `pnpm reminders:due`. Prints the drafts whose one email is due now, and can
 * queue them at once so a running worker sends them within seconds.
 *
 * Usage:
 *   pnpm drafts:due            # list what is due, send nothing
 *   pnpm drafts:due --dispatch # also queue them (needs `pnpm worker`)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { getDb } from '@/db/client';
import { dispatchDraftNudges, selectDueDraftNudges } from '@/jobs/draft-nudges';
import { DRAFT_NUDGE_DELAY_HOURS, DRAFT_NUDGE_MAX_AGE_HOURS } from '@/lib/draft-nudge';

async function main(): Promise<void> {
  const shouldDispatch = process.argv.includes('--dispatch');
  const due = await selectDueDraftNudges(getDb());

  if (due.length === 0) {
    console.log('No draft emails are due right now.');
    console.log(
      `A draft's email is due when it was started between ${DRAFT_NUDGE_DELAY_HOURS} and\n` +
        `${DRAFT_NUDGE_MAX_AGE_HOURS} hours ago, is still an unpublished, undeleted draft with a\n` +
        'slot filled in, was not made by a connected AI assistant, its organizer\n' +
        'has not turned these emails off, and no draft.nudge_sent was recorded for it.\n' +
        'To try one, move a draft back in time:\n' +
        "  UPDATE signups SET created_at = now() - interval '4 hours' WHERE id = '<sig_…>';",
    );
  } else {
    console.log(`${due.length} draft email(s) due:\n`);
    for (const r of due) console.log(`  ${r.signupId}`);
    console.log('');
  }

  if (shouldDispatch) {
    const { enqueued } = await dispatchDraftNudges();
    console.log(`Enqueued ${enqueued} job(s) on draft-nudges.send.`);
    console.log('Run `pnpm worker` in another terminal to see them sent.');
  } else if (due.length > 0) {
    console.log('Re-run with --dispatch to enqueue these now.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
