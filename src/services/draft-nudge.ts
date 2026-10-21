/**
 * "Not yet. Email me a link to finish later" on a draft's review page: the
 * email the worker would send a few hours after the draft was started
 * (`src/jobs/draft-nudges.ts`), sent now to the organizer who asked.
 */
import type { Db } from '@/db/client';
import { sendDraftEmail } from '@/email/draft-nudge';
import { activityActor, recordActivity } from '@/lib/activity';
import { serviceError, type ServiceError } from '@/lib/errors';
import { log } from '@/lib/log';
import { requireOrganizer, requireWorkspaceWrite, type Actor } from '@/lib/policy';
import { err, ok, type Result } from '@/lib/result';
import { readLiveSignup } from './locks';

/**
 * Emails the draft's links to the organizer asking, and records
 * `draft.nudge_sent`, which also stops the scheduled email for this draft.
 *
 * Sent to the actor rather than the signup's creator: "email me" means the
 * person who pressed it. Someone who can't edit the signup can't publish it
 * either, so a viewer is refused. Sent whether or not they turned the
 * scheduled email off, since they asked for this one; the switch is about
 * email nobody asked for. The caller meters it (`draftEmailPerOrganizer`).
 */
export async function emailDraftLink(
  db: Db,
  actor: Actor,
  signupId: string,
): Promise<Result<{ to: string }, ServiceError>> {
  requireOrganizer(actor);
  const signup = await readLiveSignup(db, signupId);
  if (!signup) return err(serviceError('not_found', 'signup not found'));
  requireWorkspaceWrite(actor, signup.workspaceId);
  if (signup.status !== 'draft') {
    return err(serviceError('conflict', 'this signup is already published'));
  }

  const sent = await sendDraftEmail(db, {
    signup,
    organizerId: actor.id,
    to: actor.email,
    requested: true,
  });
  if (!sent) return err(serviceError('conflict', 'no slot has anything filled in yet'));

  // Written after the send, outside any transaction, as reminder.sent is: it
  // records that the transport took the email, and there is no change to
  // write it with. The email went, so a failure here is logged rather than
  // reported: "didn't send" would be untrue and invite a second one.
  try {
    await recordActivity(db, {
      signupId: signup.id,
      workspaceId: signup.workspaceId,
      actor: activityActor(actor),
      eventType: 'draft.nudge_sent',
      payload: { channel: 'email', trigger: 'requested' },
    });
  } catch (e) {
    log.error({ err: e, signupId: signup.id }, 'draft email sent but not recorded');
  }
  return ok({ to: actor.email });
}
