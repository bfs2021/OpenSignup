import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { activity } from '@/db/schema/activity';
import { organizers } from '@/db/schema/organizers';
import { rateLimits } from '@/db/schema/rate-limits';
import { makeId } from '@/lib/ids';
import { RateLimits } from '@/lib/rate-limit';
import { draftEmailOptOutTokenFor } from '@/services/draft-email-optout';
import { GET, POST } from './route';

// A distinct source address per request, from the documentation range, so the
// per-IP limit never throttles an unrelated assertion.
let ipCounter = Math.floor(Math.random() * 200);
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 254) + 1}`;
}

function post(body: Record<string, string>, query = '', ip = nextIp()): Request {
  return new Request(`http://localhost/api/public/draft-email-optout${query}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: new URLSearchParams(body),
  });
}

describe('/api/public/draft-email-optout (db)', () => {
  const db = getDb();
  const ids: string[] = [];

  async function makeOrganizer() {
    const id = makeId('org');
    ids.push(id);
    await db
      .insert(organizers)
      .values({ id, email: `${id.slice(-10).toLowerCase()}@example.test` });
    return { id, token: draftEmailOptOutTokenFor(id) };
  }

  async function optedOutAt(id: string) {
    const [row] = await db
      .select({ at: organizers.draftEmailsOptedOutAt })
      .from(organizers)
      .where(eq(organizers.id, id));
    return row?.at ?? null;
  }

  afterAll(async () => {
    for (const id of ids) {
      await db.delete(activity).where(eq(activity.actorId, id));
      await db.delete(organizers).where(eq(organizers.id, id));
    }
  });

  it('answers a one-click POST with a bare 200, opted out', async () => {
    const o = await makeOrganizer();
    // RFC 8058: the address from List-Unsubscribe, and this body.
    const res = await POST(
      post({ 'List-Unsubscribe': 'One-Click' }, `?o=${o.id}&token=${encodeURIComponent(o.token)}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(await optedOutAt(o.id)).not.toBeNull();
  });

  it('sends a person who confirmed back to the page, opted out', async () => {
    const o = await makeOrganizer();
    const res = await POST(post({ o: o.id, token: o.token, page: '1' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain(`/unsubscribe/drafts?o=${o.id}&token=`);
    expect(res.headers.get('location')).toContain('done=off');
    expect(await optedOutAt(o.id)).not.toBeNull();

    const back = await POST(post({ o: o.id, token: o.token, page: '1', action: 'start' }));
    expect(back.headers.get('location')).toContain('done=on');
    expect(await optedOutAt(o.id)).toBeNull();
  });

  it('refuses a wrong token, after charging the caller’s rate limit', async () => {
    const o = await makeOrganizer();
    const ip = nextIp();
    const res = await POST(post({ 'List-Unsubscribe': 'One-Click' }, `?o=${o.id}&token=wrong`, ip));
    expect(res.status).toBe(403);
    expect(await optedOutAt(o.id)).toBeNull();
    const charged = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.bucket, RateLimits.draftEmailOptOutPerIp.bucket),
          eq(rateLimits.subject, ip),
        ),
      );
    expect(charged.reduce((n, r) => n + r.count, 0)).toBeGreaterThanOrEqual(1);

    const fromPage = await POST(post({ o: o.id, token: 'wrong', page: '1' }));
    expect(fromPage.status).toBe(303);
    expect(fromPage.headers.get('location')).toContain('error=1');
    expect(
      await db.select({ id: activity.id }).from(activity).where(eq(activity.actorId, o.id)),
    ).toHaveLength(0);
  });

  it('answers 200 to one-click for an account that no longer exists', async () => {
    const ghost = makeId('org');
    const res = await POST(
      post(
        { 'List-Unsubscribe': 'One-Click' },
        `?o=${ghost}&token=${encodeURIComponent(draftEmailOptOutTokenFor(ghost))}`,
      ),
    );
    expect(res.status).toBe(200);
  });

  it('sends a link that was opened to the confirm page, changing nothing', async () => {
    const o = await makeOrganizer();
    const res = GET(
      new Request(
        `http://localhost/api/public/draft-email-optout?o=${o.id}&token=${encodeURIComponent(o.token)}`,
      ),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(`/unsubscribe/drafts?o=${o.id}&token=`);
    expect(await optedOutAt(o.id)).toBeNull();
  });
});
