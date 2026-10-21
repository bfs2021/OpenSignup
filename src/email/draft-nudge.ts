/**
 * The organizer's email about a draft they haven't published, as both of its
 * senders build it: the worker, a few hours after the draft is started
 * (`src/jobs/draft-nudges.ts`), and "Email me a link to finish later" on the
 * review page (`src/services/draft-nudge.ts`).
 */
import type { Db } from '@/db/client';
import {
  builderPageUrl,
  draftEmailUnsubscribePostUrl,
  draftEmailUnsubscribeUrl,
  signupPageUrl,
} from '@/lib/links';
import { hasFilledSlot, signupHeadline } from '@/lib/signup-summary';
import { draftEmailOptOutTokenFor } from '@/services/draft-email-optout';
import { listFieldsForSignup } from '@/services/slot-fields';
import { listSlotsForSignup } from '@/services/slots';
import { sendDraftNudge } from './send';

/**
 * Sends the email about `signup` to `to`, or sends nothing and returns false
 * when no slot has anything filled in.
 *
 * That last check is the review page's own (`hasFilledSlot`), asked of the
 * slots as they are now: the email's button opens the review page, which sends
 * a draft with nothing in it to the builder instead, so an email calling it
 * ready to publish would be wrong. The scan's SQL makes the same test; this one
 * is what the page does.
 *
 * `organizerId` is whose switch the email's unsubscribe link turns off, which
 * is always the person it is sent to.
 */
export async function sendDraftEmail(
  db: Db,
  args: {
    signup: { id: string; title: string; settings: unknown };
    organizerId: string;
    to: string;
    requested: boolean;
  },
): Promise<boolean> {
  const { signup, organizerId, to, requested } = args;
  const [fields, rows] = await Promise.all([
    listFieldsForSignup(db, signup.id),
    listSlotsForSignup(db, signup.id),
  ]);
  const slots = rows.map((s) => ({
    id: s.id,
    values: (s.values as Record<string, unknown> | null) ?? {},
    capacity: s.capacity,
  }));
  if (!hasFilledSlot({ fields, slots })) return false;

  const token = draftEmailOptOutTokenFor(organizerId);
  await sendDraftNudge(
    to,
    {
      signupTitle: signup.title,
      headline: signupHeadline({ fields, slots, settings: signup.settings }),
      reviewUrl: signupPageUrl(signup.id),
      builderUrl: builderPageUrl(signup.id),
      unsubscribeUrl: draftEmailUnsubscribeUrl(organizerId, token),
      requested,
    },
    { unsubscribePostUrl: draftEmailUnsubscribePostUrl(organizerId, token) },
  );
  return true;
}
