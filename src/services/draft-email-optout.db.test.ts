import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { activity } from '@/db/schema/activity';
import { organizers } from '@/db/schema/organizers';
import { makeId } from '@/lib/ids';
import { editTokenFor } from '@/lib/token';
import {
  draftEmailOptOutTokenFor,
  optInToDraftEmails,
  optOutOfDraftEmails,
  previewDraftEmailOptOut,
} from './draft-email-optout';
import { reminderOptOutTokenFor } from './reminder-optout';

describe('draft email opt-out (db)', () => {
  const db = getDb();
  const organizerId = makeId('org');
  const otherId = makeId('org');
  const email = `${organizerId.slice(-10).toLowerCase()}@example.test`;
  const token = draftEmailOptOutTokenFor(organizerId);

  const optedOutAt = async (id = organizerId) => {
    const [row] = await db
      .select({ at: organizers.draftEmailsOptedOutAt })
      .from(organizers)
      .where(eq(organizers.id, id));
    return row?.at ?? null;
  };
  const rows = async (eventType: 'draft_email.opted_out' | 'draft_email.opted_in') =>
    db
      .select({
        actorType: activity.actorType,
        signupId: activity.signupId,
        workspaceId: activity.workspaceId,
        payload: activity.payload,
      })
      .from(activity)
      .where(and(eq(activity.actorId, organizerId), eq(activity.eventType, eventType)));

  beforeAll(async () => {
    await db.insert(organizers).values([
      { id: organizerId, email, name: 'Draft Optout Org' },
      { id: otherId, email: `${otherId.slice(-10).toLowerCase()}@example.test` },
    ]);
  });

  afterAll(async () => {
    await db.delete(activity).where(eq(activity.actorId, organizerId));
    await db.delete(organizers).where(eq(organizers.id, organizerId));
    await db.delete(organizers).where(eq(organizers.id, otherId));
  });

  it('shows whose emails a valid link turns off', async () => {
    const preview = await previewDraftEmailOptOut(db, organizerId, token);
    expect(preview).toEqual({ ok: true, value: { organizerId, email, optedOut: false } });
  });

  it('refuses a wrong token, another organizer’s, and a reminder link’s, changing nothing', async () => {
    for (const bad of [
      'not-a-token',
      draftEmailOptOutTokenFor(otherId),
      reminderOptOutTokenFor(organizerId),
      editTokenFor(organizerId),
    ]) {
      const result = await optOutOfDraftEmails(db, organizerId, bad);
      expect(result.ok ? null : result.error.code).toBe('forbidden');
    }
    expect(await optedOutAt()).toBeNull();
    expect(await rows('draft_email.opted_out')).toHaveLength(0);
  });

  it('is not found for an organizer that does not exist, even with their token', async () => {
    const ghost = makeId('org');
    const result = await optOutOfDraftEmails(db, ghost, draftEmailOptOutTokenFor(ghost));
    expect(result.ok ? null : result.error.code).toBe('not_found');
  });

  it('turns the email off once, however many times it is asked', async () => {
    const first = await optOutOfDraftEmails(db, organizerId, token);
    expect(first.ok && first.value.optedOut).toBe(true);
    const at = await optedOutAt();
    expect(at).not.toBeNull();

    // A double submit, or a provider's one-click after the person's click.
    await Promise.all([
      optOutOfDraftEmails(db, organizerId, token),
      optOutOfDraftEmails(db, organizerId, token),
    ]);
    expect(await optedOutAt()).toEqual(at);
    expect(await rows('draft_email.opted_out')).toEqual([
      { actorType: 'organizer', signupId: null, workspaceId: null, payload: {} },
    ]);
    // Only this organizer's switch.
    expect(await optedOutAt(otherId)).toBeNull();
  });

  it('turns it back on from the same link', async () => {
    const result = await optInToDraftEmails(db, organizerId, token);
    expect(result.ok && result.value.optedOut).toBe(false);
    expect(await optedOutAt()).toBeNull();
    await optInToDraftEmails(db, organizerId, token);
    expect(await rows('draft_email.opted_in')).toHaveLength(1);
  });
});
