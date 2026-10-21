import { getDb } from '@/db/client';
import { extractClientIp } from '@/auth/request-context';
import { fail, handle } from '@/lib/api-response';
import { draftEmailUnsubscribePath } from '@/lib/links';
import { log } from '@/lib/log';
import { consumeRateLimit, RateLimits } from '@/lib/rate-limit';
import { optInToDraftEmails, optOutOfDraftEmails } from '@/services/draft-email-optout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A link opened rather than POSTed, by a client that ignores
 * `List-Unsubscribe-Post` or by someone copying the URL out of the headers:
 * send them to the confirm page. Reads and changes nothing; the page checks the
 * token.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const organizerId = url.searchParams.get('o') ?? '';
  const token = url.searchParams.get('token') ?? '';
  return Response.redirect(new URL(draftEmailUnsubscribePath(organizerId, token), url.origin), 302);
}

/**
 * Turns the organizer's draft email off, or back on, as the reminder opt-out
 * route does for a participant's reminders (see its comments for the why of
 * each choice). POST, so a link scanner can't unsubscribe anyone, and the
 * target of `List-Unsubscribe` / RFC 8058 one-click, which a mail provider
 * calls unattended: the token authenticates it and repeating it changes
 * nothing.
 *
 * Unauthenticated, so it charges the per-IP limit before anything else.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);

  // The confirm page always posts `page`; one-click sends only
  // `List-Unsubscribe=One-Click`. A person gets a page back, a provider a
  // status code.
  const fromConfirmPage = form?.has('page') ?? false;
  // Only the confirm page turns it back on; one-click always means stop.
  const turningOn = String(form?.get('action') ?? '') === 'start';
  const organizerId = String(form?.get('o') ?? url.searchParams.get('o') ?? '');
  const token = String(form?.get('token') ?? url.searchParams.get('token') ?? '');
  const toPage = (query: string) =>
    Response.redirect(
      new URL(`${draftEmailUnsubscribePath(organizerId, token)}${query}`, url.origin),
      303,
    );

  return handle(async () => {
    try {
      const clientIp = extractClientIp(new Headers(request.headers));
      await consumeRateLimit(getDb(), RateLimits.draftEmailOptOutPerIp, clientIp ?? 'unknown');

      const result = turningOn
        ? await optInToDraftEmails(getDb(), organizerId, token)
        : await optOutOfDraftEmails(getDb(), organizerId, token);
      if (!result.ok) {
        if (fromConfirmPage) return toPage('&error=1');
        // One-click for an account that no longer exists: nothing is left to
        // email, which is what the provider asked for, and RFC 8058 expects
        // 2xx. A bad token or a spent rate limit still fails as itself.
        if (result.error.code === 'not_found') return new Response(null, { status: 200 });
        return fail(result.error);
      }
      if (fromConfirmPage) return toPage(`&done=${turningOn ? 'on' : 'off'}`);
      return new Response(null, { status: 200 });
    } catch (err) {
      // The rate limit throws, and so would an unreachable database; without
      // this a person would see "That didn't work" with nothing in the log.
      log.error({ err, organizerId, turningOn }, 'draft email opt-out failed');
      if (fromConfirmPage) return toPage('&error=1');
      throw err;
    }
  });
}
