import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { activity } from '@/db/schema/activity';
import { workspaceMembers } from '@/db/schema/members';
import { organizers } from '@/db/schema/organizers';
import { signups } from '@/db/schema/signups';
import { slots } from '@/db/schema/slots';
import { workspaces } from '@/db/schema/workspaces';
import { getEmailTransport } from '@/email';
import { makeId } from '@/lib/ids';
import { log } from '@/lib/log';
import type { Actor } from '@/lib/policy';
import { DEFAULT_TEMPLATE } from '@/lib/signup-templates';
import { emailDraftLink } from '@/services/draft-nudge';
import { createSignup, deleteSignup, publishSignup } from '@/services/signups';
import { selectDueDraftNudges, sendDraftNudgeJob } from './draft-nudges';

interface Fixture {
  db: Db;
  workspaceId: string;
  organizerId: string;
  email: string;
  actor: Extract<Actor, { kind: 'organizer' }>;
}

async function setupWorkspace(): Promise<Fixture> {
  const db = getDb();
  const organizerId = makeId('org');
  const workspaceId = makeId('ws');
  const slug = `nudge-${workspaceId.slice(-8).toLowerCase()}`;
  const email = `${slug}@example.test`;

  await db.transaction(async (tx) => {
    await tx.insert(organizers).values({ id: organizerId, email, name: 'Draft Email Org' });
    await tx.insert(workspaces).values({
      id: workspaceId,
      slug,
      name: 'Draft Email Workspace',
      type: 'personal',
      plan: 'free',
    });
    await tx.insert(workspaceMembers).values({
      id: makeId('mem'),
      workspaceId,
      organizerId,
      role: 'owner',
      status: 'active',
    });
  });

  return {
    db,
    workspaceId,
    organizerId,
    email,
    actor: {
      kind: 'organizer',
      id: organizerId,
      email,
      workspaceIds: [workspaceId],
      workspaceRoles: { [workspaceId]: 'owner' },
    },
  };
}

async function teardown(fx: Fixture) {
  // Workspace first: it cascades the signups, their slots and their activity,
  // which is what still references the organizer.
  await fx.db.delete(workspaces).where(eq(workspaces.id, fx.workspaceId));
  await fx.db.delete(activity).where(eq(activity.actorId, fx.organizerId));
  await fx.db.delete(organizers).where(eq(organizers.id, fx.organizerId));
}

interface DraftOptions {
  /** Hours ago the draft was started. Defaults to 4: due. */
  startedHoursAgo?: number;
  /** Whether its slot has a value. Defaults to true. */
  filled?: boolean;
  /** The `signup.created` row's templateId. Defaults to the manual form's. */
  templateId?: string;
  /** Made through a connected app's token, as the MCP tools do. */
  viaClientId?: string;
}

/**
 * A draft with the manual form's two fields (What, Date) and one slot, then
 * moved back in time by rewriting created_at, so each test places itself
 * relative to the delay and the 48-hour bound.
 */
async function makeDraft(fx: Fixture, title: string, opts: DraftOptions = {}): Promise<string> {
  const created = await createSignup(
    fx.db,
    opts.viaClientId ? { ...fx.actor, via: { clientId: opts.viaClientId } } : fx.actor,
    fx.workspaceId,
    { title, description: '', tags: [], visibility: 'unlisted', settings: {} },
    {
      template: {
        id: opts.templateId ?? 'default',
        fields: DEFAULT_TEMPLATE.fields,
        slots: [
          {
            capacity: 3,
            values: opts.filled === false ? {} : { what: 'Fruit and water', date: '2030-04-06' },
          },
        ],
      },
    },
  );
  if (!created.ok) throw new Error(`createSignup failed: ${created.error.message}`);
  await fx.db
    .update(signups)
    .set({
      createdAt: sql`now() - make_interval(mins => ${Math.round((opts.startedHoursAgo ?? 4) * 60)})`,
    })
    .where(eq(signups.id, created.value.id));
  return created.value.id;
}

async function sentRows(db: Db, signupId: string) {
  return db
    .select({ actorType: activity.actorType, actorId: activity.actorId, payload: activity.payload })
    .from(activity)
    .where(and(eq(activity.signupId, signupId), eq(activity.eventType, 'draft.nudge_sent')));
}

async function dueIds(db: Db): Promise<string[]> {
  return (await selectDueDraftNudges(db)).map((r) => r.signupId);
}

describe('draft email (db)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await setupWorkspace();
  });

  afterAll(async () => {
    await teardown(fx);
  });

  /**
   * The send job, run now, sends nothing, records nothing (beyond the
   * `rowsBefore` sends already recorded) and logs the rule the draft failed.
   */
  async function expectNoSend(signupId: string, reason: string, rowsBefore = 0) {
    const send = vi.spyOn(getEmailTransport(), 'send');
    const info = vi.spyOn(log, 'info');
    try {
      await sendDraftNudgeJob({ signupId });
      expect(send).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        { signupId, reasons: [reason] },
        'draft email no longer due; skipping',
      );
    } finally {
      send.mockRestore();
      info.mockRestore();
    }
    expect(await sentRows(fx.db, signupId)).toHaveLength(rowsBefore);
  }

  it('emails a due draft to its organizer exactly once', async () => {
    const signupId = await makeDraft(fx, 'Snack duty — Spring season');
    expect(await dueIds(fx.db)).toContain(signupId);

    const send = vi.spyOn(getEmailTransport(), 'send');
    try {
      // A scan, its job, then the next scan's job for the same draft: the
      // queue does not dedupe, the draft.nudge_sent row does.
      await sendDraftNudgeJob({ signupId });
      await sendDraftNudgeJob({ signupId });
      expect(send).toHaveBeenCalledTimes(1);
      const message = send.mock.calls[0]?.[0];
      expect(message?.to).toBe(fx.email);
      expect(message?.subject).toBe('Ready to publish: Snack duty — Spring season');
      expect(message?.text).toContain('1 slot · 1 day · 3 people each');
      expect(message?.text).toContain(`/app/signups/${signupId}\n`);
      expect(message?.text).toContain(`/app/signups/${signupId}/build`);
      expect(message?.text).toContain('a few hours ago');
      expect(message?.headers?.['List-Unsubscribe']).toContain(
        `/api/public/draft-email-optout?o=${fx.organizerId}&token=`,
      );
      expect(message?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    } finally {
      send.mockRestore();
    }

    expect(await sentRows(fx.db, signupId)).toEqual([
      { actorType: 'system', actorId: null, payload: { channel: 'email', trigger: 'scheduled' } },
    ]);
    expect(await dueIds(fx.db)).not.toContain(signupId);
  });

  it('sends nothing for a published signup', async () => {
    const signupId = await makeDraft(fx, 'Published');
    const pub = await publishSignup(fx.db, fx.actor, signupId);
    if (!pub.ok) throw new Error(pub.error.message);
    expect(await dueIds(fx.db)).not.toContain(signupId);
    await expectNoSend(signupId, 'not a draft');
  });

  it('sends nothing for a deleted draft', async () => {
    const signupId = await makeDraft(fx, 'Deleted');
    const del = await deleteSignup(fx.db, fx.actor, signupId);
    if (!del.ok) throw new Error(del.error.message);
    expect(await dueIds(fx.db)).not.toContain(signupId);
    await expectNoSend(signupId, 'signup deleted');
  });

  it('sends nothing for a draft with nothing filled in', async () => {
    const signupId = await makeDraft(fx, 'Empty', { filled: false });
    expect(await dueIds(fx.db)).not.toContain(signupId);
    await expectNoSend(signupId, 'no slot filled in');
  });

  it('does not count a value under a ref no field has, as the review page does not', async () => {
    const signupId = await makeDraft(fx, 'Stray value', { filled: false });
    await fx.db
      .update(slots)
      .set({ values: { gone: 'Left over from a deleted field', what: '' } })
      .where(eq(slots.signupId, signupId));
    expect(await dueIds(fx.db)).not.toContain(signupId);
  });

  it('counts a draft with only one field filled in', async () => {
    const signupId = await makeDraft(fx, 'Date only', { filled: false });
    await fx.db
      .update(slots)
      .set({ values: { date: '2030-04-06' } })
      .where(eq(slots.signupId, signupId));
    expect(await dueIds(fx.db)).toContain(signupId);
  });

  it('waits until a draft is a few hours old', async () => {
    const signupId = await makeDraft(fx, 'Too recent', { startedHoursAgo: 2.5 });
    expect(await dueIds(fx.db)).not.toContain(signupId);
    await expectNoSend(signupId, 'started too recently');
  });

  it('sends nothing for a draft started more than two days ago', async () => {
    const signupId = await makeDraft(fx, 'Too old', { startedHoursAgo: 49 });
    expect(await dueIds(fx.db)).not.toContain(signupId);
    await expectNoSend(signupId, 'started too long ago');
  });

  it('sends nothing for a draft a connected AI assistant created', async () => {
    const signupId = await makeDraft(fx, 'From an assistant', {
      templateId: 'mcp',
      viaClientId: 'https://assistant.example/client.json',
    });
    expect(await dueIds(fx.db)).not.toContain(signupId);
    await expectNoSend(signupId, 'made by an AI assistant');
  });

  it('counts a value of only spaces as empty, as the review page does', async () => {
    const signupId = await makeDraft(fx, 'Spaces', { filled: false });
    await fx.db
      .update(slots)
      .set({ values: { what: '   ' } })
      .where(eq(slots.signupId, signupId));
    expect(await dueIds(fx.db)).not.toContain(signupId);
    await expectNoSend(signupId, 'no slot filled in');
  });

  it('sends nothing once its organizer can no longer edit it', async () => {
    const signupId = await makeDraft(fx, 'Made a viewer');
    expect(await dueIds(fx.db)).toContain(signupId);
    await fx.db
      .update(workspaceMembers)
      .set({ role: 'viewer' })
      .where(eq(workspaceMembers.organizerId, fx.organizerId));
    try {
      expect(await dueIds(fx.db)).not.toContain(signupId);
      await expectNoSend(signupId, 'organizer can no longer edit it');
    } finally {
      await fx.db
        .update(workspaceMembers)
        .set({ role: 'owner' })
        .where(eq(workspaceMembers.organizerId, fx.organizerId));
    }
  });

  it('emails about a Magic Compose draft', async () => {
    const signupId = await makeDraft(fx, 'From Magic Compose', { templateId: 'magic-compose' });
    expect(await dueIds(fx.db)).toContain(signupId);
  });

  it('skips the send when the draft was published after being queued', async () => {
    const signupId = await makeDraft(fx, 'Published mid-flight');
    expect(await dueIds(fx.db)).toContain(signupId);
    await fx.db.update(signups).set({ status: 'open' }).where(eq(signups.id, signupId));
    await expectNoSend(signupId, 'not a draft');
  });

  it('skips the send when the draft was emptied after being queued', async () => {
    const signupId = await makeDraft(fx, 'Emptied mid-flight');
    expect(await dueIds(fx.db)).toContain(signupId);
    await fx.db.update(slots).set({ values: {} }).where(eq(slots.signupId, signupId));
    await expectNoSend(signupId, 'no slot filled in');
  });

  it('warns when the signup does not exist', async () => {
    const warn = vi.spyOn(log, 'warn');
    try {
      await sendDraftNudgeJob({ signupId: makeId('sig') });
      expect(warn).toHaveBeenCalledWith(
        { signupId: expect.any(String) },
        'signup not found for draft email',
      );
    } finally {
      warn.mockRestore();
    }
  });

  describe('"Email me a link to finish later"', () => {
    it('sends now, to whoever asked, and stops the scheduled email', async () => {
      // Started a minute ago: not due, and the request doesn't wait for it.
      const signupId = await makeDraft(fx, 'Asked for now', { startedHoursAgo: 0 });
      const send = vi.spyOn(getEmailTransport(), 'send');
      try {
        const result = await emailDraftLink(fx.db, fx.actor, signupId);
        expect(result).toEqual({ ok: true, value: { to: fx.email } });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0]?.[0].text).toContain(
          "You asked for this link on the signup's page.",
        );
      } finally {
        send.mockRestore();
      }
      expect(await sentRows(fx.db, signupId)).toEqual([
        {
          actorType: 'organizer',
          actorId: fx.organizerId,
          payload: { channel: 'email', trigger: 'requested' },
        },
      ]);

      // Three hours on, the scan passes it over.
      await fx.db
        .update(signups)
        .set({ createdAt: sql`now() - make_interval(hours => 4)` })
        .where(eq(signups.id, signupId));
      expect(await dueIds(fx.db)).not.toContain(signupId);
      await expectNoSend(signupId, 'already sent', 1);
    });

    it('refuses a published signup, and one with nothing filled in, sending nothing', async () => {
      const published = await makeDraft(fx, 'Asked after publishing');
      const pub = await publishSignup(fx.db, fx.actor, published);
      if (!pub.ok) throw new Error(pub.error.message);
      const empty = await makeDraft(fx, 'Asked while empty', { filled: false });

      const send = vi.spyOn(getEmailTransport(), 'send');
      try {
        const a = await emailDraftLink(fx.db, fx.actor, published);
        const b = await emailDraftLink(fx.db, fx.actor, empty);
        expect(a.ok ? null : a.error.code).toBe('conflict');
        expect(b.ok ? null : b.error.code).toBe('conflict');
        expect(send).not.toHaveBeenCalled();
      } finally {
        send.mockRestore();
      }
      expect(await sentRows(fx.db, published)).toHaveLength(0);
      expect(await sentRows(fx.db, empty)).toHaveLength(0);
    });

    it('refuses a viewer', async () => {
      const signupId = await makeDraft(fx, 'Asked by a viewer');
      const viewer: Actor = {
        kind: 'organizer',
        id: makeId('org'),
        email: 'viewer@example.test',
        workspaceIds: [fx.workspaceId],
        workspaceRoles: { [fx.workspaceId]: 'viewer' },
      };
      await expect(emailDraftLink(fx.db, viewer, signupId)).rejects.toMatchObject({
        serviceError: { code: 'forbidden' },
      });
      expect(await sentRows(fx.db, signupId)).toHaveLength(0);
    });
  });
});

describe('draft email for an organizer who turned it off (db)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await setupWorkspace();
  });

  afterAll(async () => {
    await teardown(fx);
  });

  it('sends nothing on schedule, but still sends one they ask for', async () => {
    const signupId = await makeDraft(fx, 'Opted out');
    expect(await dueIds(fx.db)).toContain(signupId);
    await fx.db
      .update(organizers)
      .set({ draftEmailsOptedOutAt: new Date() })
      .where(eq(organizers.id, fx.organizerId));
    expect(await dueIds(fx.db)).not.toContain(signupId);

    const send = vi.spyOn(getEmailTransport(), 'send');
    const info = vi.spyOn(log, 'info');
    try {
      await sendDraftNudgeJob({ signupId });
      expect(send).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        { signupId, reasons: ['organizer opted out'] },
        'draft email no longer due; skipping',
      );

      const asked = await emailDraftLink(fx.db, fx.actor, signupId);
      expect(asked.ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
      info.mockRestore();
    }
  });
});
