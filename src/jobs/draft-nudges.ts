/**
 * The one email an organizer gets about a draft they haven't published (#506),
 * a few hours after starting it. Scheduled the way reminders are
 * (`./reminders.ts`): nothing is queued when the draft is created; a scan every
 * 10 minutes finds the drafts that have come due and queues one send job each,
 * and a `draft.nudge_sent` activity row is what keeps a draft from being
 * picked again.
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { activity } from '@/db/schema/activity';
import { workspaceMembers } from '@/db/schema/members';
import { organizers } from '@/db/schema/organizers';
import { signups } from '@/db/schema/signups';
import { slotFields } from '@/db/schema/slot-fields';
import { slots } from '@/db/schema/slots';
import { recordActivity } from '@/lib/activity';
import { DRAFT_NUDGE_DELAY_HOURS, DRAFT_NUDGE_MAX_AGE_HOURS } from '@/lib/draft-nudge';
import { log } from '@/lib/log';
import { sendDraftEmail } from '@/email/draft-nudge';
import { failedRuleNames } from './due-rules';
import { getBoss, QUEUES, type DraftNudgeSendPayload } from './queue';

/**
 * When a draft's email is due, as named SQL rules over signups joined to their
 * organizer, in the style of `reminderDueRules`. Each holds when the email may
 * go out, and its name says why it can't when it doesn't. The scan queues jobs
 * with them, and the send job asks them again of the draft as it is when the
 * job runs, which can be hours later if the worker was stopped: by then the
 * organizer may have published or deleted it, emptied it, or turned the email
 * off, or the first job may have sent it.
 */
const draftNudgeDueRules = {
  'not a draft': eq(signups.status, 'draft'),
  'signup deleted': isNull(signups.deletedAt),
  'started too recently': sql`${signups.createdAt} <= now() - make_interval(hours => ${DRAFT_NUDGE_DELAY_HOURS})`,
  // Bounds the scan (see DRAFT_NUDGE_MAX_AGE_HOURS): the first deploy must
  // not email every old draft in the table.
  'started too long ago': sql`${signups.createdAt} > now() - make_interval(hours => ${DRAFT_NUDGE_MAX_AGE_HOURS})`,
  // A slot with something other than whitespace under one of the signup's
  // own fields. `->>` gives NULL for a missing key and for JSON null, so this
  // is `hasFilledSlot`'s test as far as SQL can ask it; the send checks again
  // with `hasFilledSlot` itself. Values under a ref no field has don't count,
  // as they don't on the page.
  'no slot filled in': sql`EXISTS (
    SELECT 1 FROM ${slots}
    JOIN ${slotFields} ON ${slotFields.signupId} = ${slots.signupId}
    WHERE ${slots.signupId} = ${signups.id}
      AND (${slots.values} ->> ${slotFields.ref}) ~ '\\S'
  )`,
  // A draft a connected AI assistant created: the organizer is in the middle
  // of a conversation with it, and the assistant gives them the links. Every
  // change made through a token carries `viaClientId` (`activityActor`).
  'made by an AI assistant': sql`NOT EXISTS (
    SELECT 1 FROM ${activity}
    WHERE ${activity.signupId} = ${signups.id}
      AND ${activity.eventType} = 'signup.created'
      AND ${activity.payload} ? 'viaClientId'
  )`,
  // The email's button opens a page to publish from: someone since made a
  // viewer of the workspace, or taken out of it, can't.
  'organizer can no longer edit it': sql`EXISTS (
    SELECT 1 FROM ${workspaceMembers}
    WHERE ${workspaceMembers.workspaceId} = ${signups.workspaceId}
      AND ${workspaceMembers.organizerId} = ${signups.organizerId}
      AND ${workspaceMembers.role} <> 'viewer'
  )`,
  'organizer opted out': isNull(organizers.draftEmailsOptedOutAt),
  // Sent already, by an earlier job or by "Email me a link to finish later".
  'already sent': sql`NOT EXISTS (
    SELECT 1 FROM ${activity}
    WHERE ${activity.signupId} = ${signups.id}
      AND ${activity.eventType} = 'draft.nudge_sent'
  )`,
} satisfies Record<string, SQL>;

const draftNudgeDueCondition = and(...Object.values(draftNudgeDueRules))!;

/**
 * The names of the rules a draft fails right now, or null when there is no
 * such signup. Only for the log line of a skipped send; it reads the same
 * rules, so the reasons can't drift from the decision.
 */
async function draftNudgeSkipReasons(db: Db, signupId: string): Promise<string[] | null> {
  const [row] = await db
    .select({ reasons: failedRuleNames(draftNudgeDueRules) })
    .from(signups)
    .innerJoin(organizers, eq(organizers.id, signups.organizerId))
    .where(eq(signups.id, signupId))
    .limit(1);
  return row ? row.reasons : null;
}

/** The drafts whose email is due now. */
export async function selectDueDraftNudges(db: Db): Promise<{ signupId: string }[]> {
  return db
    .select({ signupId: signups.id })
    .from(signups)
    .innerJoin(organizers, eq(organizers.id, signups.organizerId))
    .where(draftNudgeDueCondition);
}

/** Queues one draft-nudges.send job per due draft. */
export async function dispatchDraftNudges(): Promise<{ enqueued: number }> {
  const rows = await selectDueDraftNudges(getDb());
  if (rows.length === 0) return { enqueued: 0 };
  const boss = await getBoss();
  let enqueued = 0;
  for (const r of rows) {
    const payload: DraftNudgeSendPayload = { signupId: r.signupId };
    // As in dispatchReminders, the singletonKey dedupes nothing on a standard
    // queue; a draft still due at the next scan gets another job, and the
    // 'already sent' rule in the send job is what stops a second email.
    const jobId = await boss.send(QUEUES.draftNudgeSend, payload, { singletonKey: r.signupId });
    if (jobId) enqueued++;
  }
  log.info({ enqueued, scanned: rows.length }, 'draft emails enqueued');
  return { enqueued };
}

export async function sendDraftNudgeJob(payload: DraftNudgeSendPayload): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({
      id: signups.id,
      title: signups.title,
      settings: signups.settings,
      workspaceId: signups.workspaceId,
      organizerId: signups.organizerId,
      email: organizers.email,
    })
    .from(signups)
    .innerJoin(organizers, eq(organizers.id, signups.organizerId))
    .where(and(eq(signups.id, payload.signupId), draftNudgeDueCondition))
    .limit(1);

  if (!row) {
    const reasons = await draftNudgeSkipReasons(db, payload.signupId);
    if (reasons === null) {
      log.warn({ signupId: payload.signupId }, 'signup not found for draft email');
    } else {
      log.info({ signupId: payload.signupId, reasons }, 'draft email no longer due; skipping');
    }
    return;
  }

  // The 'already sent' rule above is the only thing stopping a second email,
  // and it is a check, not a lock, as in sendReminderJob: it holds while one
  // worker process runs send jobs one at a time, which is why an instance runs
  // exactly one `pnpm worker`. It can't catch an email that went out when
  // recording it then failed, nor a "Email me a link" click landing in the
  // same moment; either way the organizer gets two.
  const sent = await sendDraftEmail(db, {
    signup: row,
    organizerId: row.organizerId,
    to: row.email,
    requested: false,
  });
  if (!sent) {
    // The SQL rule passed but the page's own test didn't: a value the page
    // doesn't show, such as a date it can't read. Named apart from the rule.
    log.info(
      { signupId: payload.signupId, reasons: ['nothing filled in shows on the page'] },
      'draft email no longer due; skipping',
    );
    return;
  }

  await recordActivity(db, {
    signupId: row.id,
    workspaceId: row.workspaceId,
    actor: { actorId: null, actorType: 'system' },
    eventType: 'draft.nudge_sent',
    payload: { channel: 'email', trigger: 'scheduled' },
  });
}
