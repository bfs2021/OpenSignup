'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { requireOrganizerSession, toActor } from '@/auth/session';
import type { EmailDraftLinkState } from '@/components/review/EmailDraftLink';
import { SAVE_ERROR_MESSAGE } from '@/components/ui/save-notice';
import { ServiceException, type ErrorCode, type ServiceError } from '@/lib/errors';
import { log } from '@/lib/log';
import { requireOrganizerId } from '@/lib/policy';
import { chargeRateLimit, RateLimits } from '@/lib/rate-limit';
import type { Result } from '@/lib/result';
import type {
  DraftFixRequest,
  DraftFixUndo,
  RemoveDayRequest,
  SetCapacityRequest,
} from '@/schemas/draft-fixes';
import { removeCommitment } from '@/services/commitments';
import {
  applyDraftFix,
  removeDraftDay,
  setDraftCapacity,
  undoDraftFix,
} from '@/services/draft-fixes';
import { emailDraftLink } from '@/services/draft-nudge';
import { closeSignup, deleteSignup, publishSignup, updateSignup } from '@/services/signups';
import { fixRefusal, type FixStep } from './fix-refusal';
import { removeRefusal } from './remove-refusal';

function revalidateSignup(id: string) {
  revalidatePath(`/app/signups/${id}`, 'layout');
}

async function requireActor() {
  return toActor(await requireOrganizerSession());
}

/**
 * Publish, from the header, the phone's More actions sheet and the review
 * page alike. Once it worked, the organizer lands on the share step ("It's
 * live. Now send the link."); a refusal stays on the page it came from.
 */
export async function publishAction(signupId: string) {
  const actor = await requireActor();
  const result = await publishSignup(getDb(), actor, signupId);
  revalidateSignup(signupId);
  if (result.ok) {
    redirect(`/app/signups/${signupId}/share`);
  }
}

/**
 * The review page's "Not yet. Email me a link to finish later": sends the
 * draft email to the organizer now (`emailDraftLink`), metered per organizer,
 * and says how it went in place. Revalidates nothing: the page has not
 * changed, and a re-render would count as another view of it.
 */
export async function emailDraftLinkAction(
  signupId: string,
  _state: EmailDraftLinkState,
  _form: FormData,
): Promise<EmailDraftLinkState> {
  const actor = await requireActor();
  try {
    const db = getDb();
    const retryAfter = await chargeRateLimit(
      db,
      RateLimits.draftEmailPerOrganizer,
      requireOrganizerId(actor),
    );
    if (retryAfter !== null) {
      const minutes = Math.max(1, Math.ceil(retryAfter / 60));
      return {
        error: `You’ve asked for a few already. Try again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`,
      };
    }
    const result = await emailDraftLink(db, actor, signupId);
    if (!result.ok) return { error: SAVE_ERROR_MESSAGE[result.error.code] };
    return { sent: true };
  } catch (e) {
    // The policy guard throws rather than returning: a viewer's role.
    if (e instanceof ServiceException) return { error: SAVE_ERROR_MESSAGE[e.serviceError.code] };
    // The mail transport, most likely. The organizer can try again.
    log.error({ err: e, signupId }, 'draft email request failed');
    return { error: 'That didn’t send. Try again in a moment.' };
  }
}

export async function closeAction(signupId: string) {
  const actor = await requireActor();
  await closeSignup(getDb(), actor, signupId);
  revalidateSignup(signupId);
}

/**
 * The Settings tab's "Ask for an email address". Sends only `requireEmail`,
 * which `updateSignup` merges over the stored settings. Anything but Optional
 * saves Required, the default. A refusal shows in plain words, by its code.
 */
export async function setRequireEmailAction(signupId: string, formData: FormData) {
  const actor = await requireActor();
  const requireEmail = formData.get('requireEmail') !== 'optional';
  const settingsPath = `/app/signups/${signupId}/settings`;
  let refused: ErrorCode | null = null;
  try {
    const result = await updateSignup(getDb(), actor, signupId, { settings: { requireEmail } });
    if (!result.ok) refused = result.error.code;
  } catch (e) {
    // The policy guard throws rather than returning: a viewer's role.
    if (!(e instanceof ServiceException)) throw e;
    refused = e.serviceError.code;
  }
  if (refused !== null) {
    redirect(`${settingsPath}?error=${encodeURIComponent(SAVE_ERROR_MESSAGE[refused])}`);
  }
  // This tab re-renders with the saved choice. The public page is dynamic, so
  // its form reads the change on its next request.
  revalidateSignup(signupId);
  redirect(`${settingsPath}?saved=1`);
}

/**
 * The Responses tab's Remove. Once the person is off the slot, revalidates the
 * signup's pages, so the row re-renders as removed, and returns null. A
 * refusal (a viewer's role, a signup deleted meanwhile) returns what to tell
 * the organizer, by its code (`removeRefusal`), and revalidates nothing: the
 * page stays as it is, so the confirmation stays open to show it. After a
 * delete, a revalidate would swap the page for "signup not found" and the
 * message would never be seen.
 */
export async function removeCommitmentAction(
  signupId: string,
  commitmentId: string,
): Promise<{ error: string } | null> {
  const actor = await requireActor();
  let result: Awaited<ReturnType<typeof removeCommitment>>;
  try {
    result = await removeCommitment(getDb(), actor, commitmentId);
  } catch (e) {
    // The policy guard throws rather than returning.
    if (e instanceof ServiceException) return { error: removeRefusal(e.serviceError.code) };
    throw e;
  }
  if (!result.ok) return { error: removeRefusal(result.error.code) };
  // The public page and the edit link are dynamic, so they read the change on
  // their next request.
  revalidateSignup(signupId);
  return null;
}

/**
 * Runs a review-page fix, Remove day, "People for each slot", or Undo, and
 * turns a refusal into plain words (`fixRefusal`): a viewer's, which the
 * policy guard throws, included.
 */
async function runFix<T>(
  step: FixStep,
  signupId: string,
  run: () => Promise<Result<T, ServiceError>>,
): Promise<{ ok: T } | { error: string }> {
  let result: Result<T, ServiceError>;
  try {
    result = await run();
  } catch (e) {
    if (e instanceof ServiceException) return { error: fixRefusal(e.serviceError, step) };
    throw e;
  }
  if (!result.ok) {
    // The page comes back as the signup is now, with the message: it may be
    // out of date, or an undo may have done its first step before the second
    // was refused. Not for a refusal of the person or of a signup that's no
    // longer a draft, or gone: the re-render would send the page elsewhere
    // and the message would never be seen.
    const { code, details } = result.error;
    const leave =
      details?.reason === 'not_draft' ||
      code === 'forbidden' ||
      code === 'unauthorized' ||
      code === 'not_found';
    if (!leave) revalidateSignup(signupId);
    return { error: fixRefusal(result.error, step) };
  }
  // The review page comes back with this response, without the notice.
  revalidateSignup(signupId);
  return { ok: result.value };
}

/**
 * A one-tap fix on a draft's review page ("Remove field", "Remove it",
 * "Group by …", a field's new name). Returns what was done, in words, and
 * the undo for it, which the page keeps until the next fix.
 */
export async function applyDraftFixAction(
  signupId: string,
  request: DraftFixRequest,
): Promise<{ done: string; undo: DraftFixUndo } | { error: string }> {
  const actor = await requireActor();
  const result = await runFix('fix', signupId, () =>
    applyDraftFix(getDb(), actor, signupId, request),
  );
  if ('error' in result) return result;
  return { done: result.ok.done, undo: result.ok.undo };
}

/**
 * Remove day on a draft's review page: every slot of one date's group, as the
 * page showed it. Returns what was done, in words, and the undo for it, which
 * the page keeps until its next change and sends back to
 * `undoDraftFixAction`, as it does a fix's.
 */
export async function removeDayAction(
  signupId: string,
  request: RemoveDayRequest,
): Promise<{ done: string; undo: DraftFixUndo } | { error: string }> {
  const actor = await requireActor();
  const result = await runFix('remove_day', signupId, () =>
    removeDraftDay(getDb(), actor, signupId, request),
  );
  if ('error' in result) return result;
  return { done: result.ok.done, undo: result.ok.undo };
}

/**
 * "People for each slot" on a draft's review page: every slot, as the page
 * showed them, to take `request.capacity` people. Returns what was done, in
 * words, and the undo for it, as Remove day does; no undo when every slot
 * already took that number, as nothing was done. The page comes back either
 * way, so a number set meanwhile elsewhere shows.
 */
export async function setCapacityAction(
  signupId: string,
  request: SetCapacityRequest,
): Promise<{ done: string; undo: DraftFixUndo | null } | { error: string }> {
  const actor = await requireActor();
  const result = await runFix('set_capacity', signupId, () =>
    setDraftCapacity(getDb(), actor, signupId, request),
  );
  if ('error' in result) return result;
  return { done: result.ok.done, undo: result.ok.undo };
}

/**
 * Undo, for the last fix, Remove day or "People for each slot" the review
 * page made. Null once it's undone.
 */
export async function undoDraftFixAction(
  signupId: string,
  undo: DraftFixUndo,
): Promise<{ error: string } | null> {
  const actor = await requireActor();
  const result = await runFix('undo', signupId, () => undoDraftFix(getDb(), actor, signupId, undo));
  return 'error' in result ? result : null;
}

export async function deleteSignupAction(signupId: string) {
  const actor = await requireActor();
  const result = await deleteSignup(getDb(), actor, signupId);
  if (!result.ok) {
    // In plain words by its code, as Save on the same tab is. A viewer's
    // refusal is thrown, not returned, and is not caught here.
    const message = SAVE_ERROR_MESSAGE[result.error.code];
    redirect(`/app/signups/${signupId}/settings?error=${encodeURIComponent(message)}`);
  }
  // Bust any open tab on the deleted signup so the next interaction shows the
  // organizer "signup not found" state instead of a stale cached layout.
  revalidatePath(`/app/signups/${signupId}`, 'layout');
  revalidatePath('/app');
  redirect('/app');
}
