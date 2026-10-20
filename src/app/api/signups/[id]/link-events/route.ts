import { organizerRoute } from '@/lib/organizer-route';
import { recordSignupLinkEvent } from '@/services/signup-link-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A beacon from the organizer's pages when they copy or share a signup's
 * link: `?event=copied|shared&surface=…`, no body. Behind the organizer's
 * session rather than a per-IP rate limit, since only a signed-in member of
 * the signup's workspace can write one.
 */
export const POST = organizerRoute<{ id: string }>(async ({ req, db, actor, params: { id } }) => {
  const query = new URL(req.url).searchParams;
  return recordSignupLinkEvent(db, actor, id, {
    event: query.get('event'),
    surface: query.get('surface'),
  });
});
