import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { log } from '@/lib/log';
import { dispatchDraftNudges, sendDraftNudgeJob } from './draft-nudges';
import { getBoss, QUEUES, type DraftNudgeSendPayload, type ReminderSendPayload } from './queue';
import { dispatchReminders, sendReminderJob } from './reminders';
import { runHousekeeping } from './housekeeping';

async function main() {
  const boss = await getBoss();

  await boss.work<ReminderSendPayload>(QUEUES.reminderSend, async (jobs) => {
    for (const job of jobs) {
      try {
        await sendReminderJob(job.data);
      } catch (err) {
        log.error({ err, commitmentId: job.data.commitmentId }, 'reminder send failed');
        throw err; // pg-boss retries it: twice, at once, with no backoff configured
      }
    }
  });

  // Dispatcher: poll every 10 minutes for reminders that have come due.
  await boss.schedule(QUEUES.reminderDispatch, '*/10 * * * *');
  await boss.work(QUEUES.reminderDispatch, async () => {
    try {
      await dispatchReminders();
    } catch (err) {
      log.error({ err }, 'reminder dispatch failed');
      throw err;
    }
  });

  // The email about an unpublished draft. Same shape as reminders: a scan
  // queues one send job per due draft, and the send job checks every rule
  // again, so it is as safe as reminders are with one worker process and no
  // safer with two (see sendDraftNudgeJob).
  await boss.work<DraftNudgeSendPayload>(QUEUES.draftNudgeSend, async (jobs) => {
    for (const job of jobs) {
      try {
        await sendDraftNudgeJob(job.data);
      } catch (err) {
        log.error({ err, signupId: job.data.signupId }, 'draft email send failed');
        throw err; // pg-boss retries it, as it does a reminder
      }
    }
  });

  // Every 10 minutes, five minutes off the reminder scan so the two don't run
  // together. The email is due DRAFT_NUDGE_DELAY_HOURS after a draft is
  // started, so it goes out within 10 minutes of that; hourly would make "a
  // few hours" anything up to an hour later, for a query that is cheap either
  // way (drafts only, created within the last two days).
  await boss.schedule(QUEUES.draftNudgeDispatch, '5,15,25,35,45,55 * * * *');
  await boss.work(QUEUES.draftNudgeDispatch, async () => {
    try {
      await dispatchDraftNudges();
    } catch (err) {
      log.error({ err }, 'draft email dispatch failed');
      throw err;
    }
  });

  // Housekeeping: hourly. Reads already ignore expired rows, so a missed run
  // costs disk, never correctness.
  await boss.schedule(QUEUES.housekeeping, '17 * * * *');
  await boss.work(QUEUES.housekeeping, async () => {
    try {
      await runHousekeeping();
    } catch (err) {
      log.error({ err }, 'housekeeping failed');
      throw err;
    }
  });

  log.info(
    'signup worker started · reminderDispatch + reminderSend + draftNudgeDispatch + draftNudgeSend + housekeeping queues online',
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'stopping worker');
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err }, 'worker failed to start');
  process.exit(1);
});
