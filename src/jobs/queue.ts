import PgBoss from 'pg-boss';
import { getEnv } from '@/lib/env';

declare global {
  var __signup_pgboss__: PgBoss | undefined;
}

export const QUEUES = {
  reminderDispatch: 'reminders.dispatch',
  reminderSend: 'reminders.send',
  /** Every 10 minutes: the drafts whose one email has come due (`./draft-nudges.ts`). */
  draftNudgeDispatch: 'draft-nudges.dispatch',
  draftNudgeSend: 'draft-nudges.send',
  /** Hourly deletion of expired OAuth records and closed rate-limit windows. */
  housekeeping: 'housekeeping.sweep',
} as const;

export async function getBoss(): Promise<PgBoss> {
  if (!globalThis.__signup_pgboss__) {
    const env = getEnv();
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: 'pgboss',
      retentionDays: 14,
    });
    await boss.start();
    for (const name of Object.values(QUEUES)) {
      await boss.createQueue(name);
    }
    globalThis.__signup_pgboss__ = boss;
  }
  return globalThis.__signup_pgboss__;
}

export interface ReminderSendPayload {
  commitmentId: string;
}

export interface DraftNudgeSendPayload {
  signupId: string;
}
