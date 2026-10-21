/**
 * The organizer's switch for the one email about a draft they haven't
 * published (#506), from the link in that email.
 *
 * Shaped like the participant's reminder opt-out (`./reminder-optout.ts`): the
 * link carries `HMAC(AUTH_SECRET, organizerId + 'draft-email-optout')`, so
 * nothing extra is stored and the token can't be replayed as any other kind.
 * No sign-in: the link has to work from a phone that has never signed in, and
 * from a mail provider's unattended one-click POST, and the token is what
 * proves the request came from that organizer's inbox.
 *
 * One switch per organizer, on `organizers.draft_emails_opted_out_at`, for
 * every draft they start in any workspace.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { organizers } from '@/db/schema/organizers';
import { recordActivity } from '@/lib/activity';
import { serviceError, type ServiceError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';
import { editTokenFor, hashToken, verifyHash } from '@/lib/token';

const OPTOUT_SCOPE = 'draft-email-optout';

export function draftEmailOptOutTokenFor(organizerId: string): string {
  return editTokenFor(organizerId, OPTOUT_SCOPE);
}

export interface DraftEmailOptOutTarget {
  organizerId: string;
  email: string;
  optedOut: boolean;
}

async function loadVerified(
  db: Db,
  organizerId: string,
  token: string,
): Promise<Result<DraftEmailOptOutTarget, ServiceError>> {
  // Constant-time, and before any read, so a wrong token costs no lookup and
  // says nothing about whether the organizer exists. (The route has charged a
  // rate limit before calling in, which is one write.)
  if (!verifyHash(token, hashToken(draftEmailOptOutTokenFor(organizerId)))) {
    return err(serviceError('forbidden', 'that unsubscribe link is not valid'));
  }
  const [row] = await db
    .select({
      id: organizers.id,
      email: organizers.email,
      optedOutAt: organizers.draftEmailsOptedOutAt,
    })
    .from(organizers)
    .where(eq(organizers.id, organizerId))
    .limit(1);
  if (!row) return err(serviceError('not_found', 'that account could not be found'));
  return ok({ organizerId: row.id, email: row.email, optedOut: row.optedOutAt !== null });
}

/** Reads the target of an unsubscribe link, for the confirm page. */
export async function previewDraftEmailOptOut(
  db: Db,
  organizerId: string,
  token: string,
): Promise<Result<DraftEmailOptOutTarget, ServiceError>> {
  return loadVerified(db, organizerId, token);
}

/**
 * Sets the switch and logs it, or does nothing when it is already that way.
 * The state check is in the UPDATE's own predicate, as in `reminder-optout.ts`,
 * so a double submit, or a provider's one-click racing the person's click,
 * writes one activity row, not two.
 */
async function setOptOut(
  db: Db,
  target: DraftEmailOptOutTarget,
  optedOut: boolean,
): Promise<Result<DraftEmailOptOutTarget, ServiceError>> {
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(organizers)
      .set({ draftEmailsOptedOutAt: optedOut ? new Date() : null })
      .where(
        and(
          eq(organizers.id, target.organizerId),
          optedOut
            ? isNull(organizers.draftEmailsOptedOutAt)
            : isNotNull(organizers.draftEmailsOptedOutAt),
        ),
      )
      .returning({ id: organizers.id });
    if (changed.length === 0) return;

    // No signup and no workspace: the switch is the organizer's own and spans
    // every workspace they belong to, like a connected app's grant.
    await recordActivity(tx, {
      actor: { actorId: target.organizerId, actorType: 'organizer' },
      eventType: optedOut ? 'draft_email.opted_out' : 'draft_email.opted_in',
      payload: {},
    });
  });
  return ok({ ...target, optedOut });
}

/** Turns the draft email off. Idempotent: a second opt-out is a no-op success. */
export async function optOutOfDraftEmails(
  db: Db,
  organizerId: string,
  token: string,
): Promise<Result<DraftEmailOptOutTarget, ServiceError>> {
  const found = await loadVerified(db, organizerId, token);
  if (!found.ok) return found;
  return setOptOut(db, found.value, true);
}

/**
 * Turns it back on, from the confirm page, so a mistaken click isn't
 * permanent: there is no setting for it anywhere else.
 */
export async function optInToDraftEmails(
  db: Db,
  organizerId: string,
  token: string,
): Promise<Result<DraftEmailOptOutTarget, ServiceError>> {
  const found = await loadVerified(db, organizerId, token);
  if (!found.ok) return found;
  return setOptOut(db, found.value, false);
}
