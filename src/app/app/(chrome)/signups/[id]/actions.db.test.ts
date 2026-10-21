import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { activity } from '@/db/schema/activity';
import { workspaceMembers } from '@/db/schema/members';
import { organizers } from '@/db/schema/organizers';
import { signups } from '@/db/schema/signups';
import { slots as slotsTable } from '@/db/schema/slots';
import { workspaces } from '@/db/schema/workspaces';
import { getEmailTransport } from '@/email';
import { slotSetFingerprint } from '@/lib/draft-fixes';
import { makeId } from '@/lib/ids';
import type { Actor } from '@/lib/policy';
import { chargeRateLimit, RateLimits } from '@/lib/rate-limit';
import { DEFAULT_TEMPLATE, type SignupTemplate } from '@/lib/signup-templates';
import type {
  DraftFixKind,
  DraftFixRequest,
  DraftFixUndo,
  RemoveDayRequest,
  SetCapacityRequest,
} from '@/schemas/draft-fixes';
import { createSignup, publishSignup, updateSignup } from '@/services/signups';
import { deleteField, listFieldsForSignup, updateField } from '@/services/slot-fields';
import { addSlot, deleteDraftSlots, updateSlot } from '@/services/slots';
import {
  applyDraftFixAction,
  deleteSignupAction,
  emailDraftLinkAction,
  publishAction,
  removeDayAction,
  setCapacityAction,
  setRequireEmailAction,
  undoDraftFixAction,
} from './actions';

// The action reads the organizer from the session cookie. Tests hand it one
// directly instead of going through Auth.js.
const session = vi.hoisted(() => ({ actor: { kind: 'anonymous' } as Actor }));
vi.mock('@/auth/session', () => ({
  requireOrganizerSession: async () => ({}),
  toActor: () => session.actor,
}));

// Next's redirect() throws to end the action; this one throws the address.
class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect to ${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirected(url);
  },
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

/** Where an action sends the organizer when it ends. */
async function redirectOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (e) {
    if (e instanceof Redirected) return e.url;
    throw e;
  }
  throw new Error('the action did not redirect');
}

async function submit(signupId: string, choice: 'required' | 'optional'): Promise<string> {
  const form = new FormData();
  form.set('requireEmail', choice);
  return redirectOf(() => setRequireEmailAction(signupId, form));
}

describe('setRequireEmailAction (db)', () => {
  const db = getDb();
  const organizerId = makeId('org');
  const workspaceId = makeId('ws');
  const slug = `test-${workspaceId.slice(-8).toLowerCase()}`;
  const email = `${slug}@example.test`;
  const owner: Actor = {
    kind: 'organizer',
    id: organizerId,
    email,
    workspaceIds: [workspaceId],
    workspaceRoles: { [workspaceId]: 'owner' },
  };
  // requireWorkspaceWrite reads actor.workspaceRoles, so no member row is needed.
  const viewer: Actor = {
    kind: 'organizer',
    id: makeId('org'),
    email: 'viewer@example.test',
    workspaceIds: [workspaceId],
    workspaceRoles: { [workspaceId]: 'viewer' },
  };
  let signupId: string;

  const stored = async () => {
    const [row] = await db
      .select({ settings: signups.settings })
      .from(signups)
      .where(eq(signups.id, signupId));
    return row?.settings as Record<string, unknown>;
  };
  const updates = async () =>
    db
      .select({ id: activity.id })
      .from(activity)
      .where(and(eq(activity.signupId, signupId), eq(activity.eventType, 'signup.updated')));

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await tx.insert(organizers).values({ id: organizerId, email, name: 'Test Org' });
      await tx.insert(workspaces).values({
        id: workspaceId,
        slug,
        name: 'Test Workspace',
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
    const created = await createSignup(db, owner, workspaceId, {
      title: 'Email setting',
      description: '',
      tags: [],
      visibility: 'unlisted',
      settings: {},
    });
    if (!created.ok) throw new Error(created.error.message);
    signupId = created.value.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(organizers).where(eq(organizers.id, organizerId));
  });

  beforeEach(() => {
    revalidatePath.mockClear();
  });

  it('saves the choice and comes back saying so', async () => {
    session.actor = owner;
    expect(await submit(signupId, 'optional')).toBe(`/app/signups/${signupId}/settings?saved=1`);
    expect((await stored()).requireEmail).toBe(false);
    expect(revalidatePath).toHaveBeenCalled();

    expect(await submit(signupId, 'required')).toBe(`/app/signups/${signupId}/settings?saved=1`);
    expect((await stored()).requireEmail).toBe(true);
  });

  // The write guard throws for a viewer rather than returning a Result.
  it('refuses a viewer in plain words and writes nothing', async () => {
    session.actor = owner;
    await submit(signupId, 'optional');
    const before = await stored();
    const updatesBefore = (await updates()).length;
    revalidatePath.mockClear();

    session.actor = viewer;
    const url = await submit(signupId, 'required');
    expect(url).toBe(
      `/app/signups/${signupId}/settings?error=${encodeURIComponent('You don’t have edit access.')}`,
    );
    expect(url).not.toMatch(/saved|cannot%20modify/);
    expect(await stored()).toEqual(before);
    expect(await updates()).toHaveLength(updatesBefore);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('says a signup that is gone is no longer available', async () => {
    session.actor = owner;
    expect(await submit('sig_nope', 'optional')).toBe(
      `/app/signups/sig_nope/settings?error=${encodeURIComponent('No longer available.')}`,
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// The review page's "Not yet. Email me a link to finish later".
describe('emailDraftLinkAction (db)', () => {
  const db = getDb();
  const organizerId = makeId('org');
  const workspaceId = makeId('ws');
  const slug = `test-${workspaceId.slice(-8).toLowerCase()}`;
  const email = `${slug}@example.test`;
  const owner: Actor = {
    kind: 'organizer',
    id: organizerId,
    email,
    workspaceIds: [workspaceId],
    workspaceRoles: { [workspaceId]: 'owner' },
  };
  let signupId: string;

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await tx.insert(organizers).values({ id: organizerId, email, name: 'Test Org' });
      await tx.insert(workspaces).values({
        id: workspaceId,
        slug,
        name: 'Test Workspace',
        type: 'personal',
        plan: 'free',
      });
    });
    const created = await createSignup(
      db,
      owner,
      workspaceId,
      { title: 'Email me later', description: '', tags: [], visibility: 'unlisted', settings: {} },
      {
        template: {
          ...DEFAULT_TEMPLATE,
          slots: [{ capacity: 2, values: { what: 'Fruit and water' } }],
        },
      },
    );
    if (!created.ok) throw new Error(created.error.message);
    signupId = created.value.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(organizers).where(eq(organizers.id, organizerId));
  });

  beforeEach(() => {
    revalidatePath.mockClear();
  });

  it('sends the email and says so in place, without reloading the page', async () => {
    session.actor = owner;
    const send = vi.spyOn(getEmailTransport(), 'send');
    try {
      expect(await emailDraftLinkAction(signupId, null, new FormData())).toEqual({ sent: true });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0].to).toBe(email);
    } finally {
      send.mockRestore();
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('stops after a few in an hour, sending nothing', async () => {
    session.actor = owner;
    // The first test spent one; spend the rest of the hour's quota.
    for (let i = 1; i < RateLimits.draftEmailPerOrganizer.max; i++) {
      await chargeRateLimit(db, RateLimits.draftEmailPerOrganizer, organizerId);
    }
    const send = vi.spyOn(getEmailTransport(), 'send');
    try {
      const state = await emailDraftLinkAction(signupId, null, new FormData());
      expect(state).toEqual({ error: expect.stringMatching(/^You’ve asked for a few already/) });
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it('refuses a viewer in plain words', async () => {
    session.actor = {
      kind: 'organizer',
      id: makeId('org'),
      email: 'viewer@example.test',
      workspaceIds: [workspaceId],
      workspaceRoles: { [workspaceId]: 'viewer' },
    };
    expect(await emailDraftLinkAction(signupId, null, new FormData())).toEqual({
      error: 'You don’t have edit access.',
    });
  });
});

// The same tab's Delete, whose refusal reads like Save's.
describe('deleteSignupAction (db)', () => {
  it('says a signup that is gone is no longer available, not the service text', async () => {
    session.actor = {
      kind: 'organizer',
      id: makeId('org'),
      email: 'pat@example.test',
      workspaceIds: [],
      workspaceRoles: {},
    };
    const url = await redirectOf(() => deleteSignupAction('sig_nope'));
    expect(url).toBe(
      `/app/signups/sig_nope/settings?error=${encodeURIComponent('No longer available.')}`,
    );
    expect(url).not.toMatch(/signup%20not%20found/);
  });
});

// Publish, from the header, the phone's sheet and the review page.
describe('publishAction (db)', () => {
  const db = getDb();
  const organizerId = makeId('org');
  const workspaceId = makeId('ws');
  const slug = `pub-${workspaceId.slice(-8).toLowerCase()}`;
  const owner: Actor = {
    kind: 'organizer',
    id: organizerId,
    email: `${slug}@example.test`,
    workspaceIds: [workspaceId],
    workspaceRoles: { [workspaceId]: 'owner' },
  };

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await tx.insert(organizers).values({ id: organizerId, email: owner.email });
      await tx.insert(workspaces).values({
        id: workspaceId,
        slug,
        name: 'Publish Test',
        type: 'personal',
        plan: 'free',
      });
    });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(organizers).where(eq(organizers.id, organizerId));
  });

  it('lands on the share step once the signup is open', async () => {
    session.actor = owner;
    const created = await createSignup(db, owner, workspaceId, {
      title: 'Snack duty',
      description: '',
      tags: [],
      visibility: 'unlisted',
      settings: {},
    });
    if (!created.ok) throw new Error(created.error.message);
    const id = created.value.id;

    expect(await redirectOf(() => publishAction(id))).toBe(`/app/signups/${id}/share`);
    const [row] = await db
      .select({ status: signups.status })
      .from(signups)
      .where(eq(signups.id, id));
    expect(row?.status).toBe('open');

    // A second click finds it open already: refused, so it stays where it was.
    await expect(publishAction(id)).resolves.toBeUndefined();
  });
});

// The review page's one-tap fixes and Undo (#503), through the actions the
// page calls, on drafts made for each test.
describe('applyDraftFixAction and undoDraftFixAction (db)', () => {
  const db = getDb();
  const organizerId = makeId('org');
  const workspaceId = makeId('ws');
  const slug = `fix-${workspaceId.slice(-8).toLowerCase()}`;
  const owner: Actor = {
    kind: 'organizer',
    id: organizerId,
    email: `${slug}@example.test`,
    workspaceIds: [workspaceId],
    workspaceRoles: { [workspaceId]: 'owner' },
  };
  const viewer: Actor = {
    kind: 'organizer',
    id: makeId('org'),
    email: 'viewer@example.test',
    workspaceIds: [workspaceId],
    workspaceRoles: { [workspaceId]: 'viewer' },
  };

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await tx.insert(organizers).values({ id: organizerId, email: owner.email });
      await tx.insert(workspaces).values({
        id: workspaceId,
        slug,
        name: 'Fix Test',
        type: 'personal',
        plan: 'free',
      });
    });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(organizers).where(eq(organizers.id, organizerId));
  });

  beforeEach(() => {
    session.actor = owner;
    revalidatePath.mockClear();
  });

  const text = (ref: string, label: string, sortOrder: number) =>
    ({
      ref,
      label,
      fieldType: 'text',
      sortOrder,
      config: { fieldType: 'text', maxLength: 200 },
    }) as const;
  const dateField = (ref: string, label: string, sortOrder: number) =>
    ({ ref, label, fieldType: 'date', sortOrder, config: { fieldType: 'date' } }) as const;

  /** Everything a fix or its undo can touch, by position, without ids. */
  async function snapshot(signupId: string) {
    const [row] = await db
      .select({ settings: signups.settings, status: signups.status })
      .from(signups)
      .where(eq(signups.id, signupId));
    const fields = await listFieldsForSignup(db, signupId);
    const slots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.signupId, signupId))
      .orderBy(asc(slotsTable.sortOrder), asc(slotsTable.slotAt), asc(slotsTable.createdAt));
    return {
      status: row?.status,
      settings: row?.settings as Record<string, unknown>,
      fields: fields.map(({ ref, label, fieldType, sortOrder, config }) => ({
        ref,
        label,
        fieldType,
        sortOrder,
        config,
      })),
      slots: slots.map((s) => ({
        values: s.values,
        capacity: s.capacity,
        sortOrder: s.sortOrder,
        status: s.status,
        slotAt: s.slotAt?.toISOString() ?? null,
      })),
      // With ids, to show a refused fix changed nothing at all.
      ids: { fields: fields.map((f) => f.id), slots: slots.map((s) => s.id) },
    };
  }
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const withoutIds = ({ ids: _ids, ...rest }: Snapshot) => rest;

  async function events(
    signupId: string,
    eventType:
      | 'review.notice_accepted'
      | 'review.fix_undone'
      | 'review.slots_edited'
      | 'slot.deleted'
      | 'slot.updated',
  ) {
    const rows = await db
      .select({ payload: activity.payload, actorId: activity.actorId })
      .from(activity)
      .where(and(eq(activity.signupId, signupId), eq(activity.eventType, eventType)));
    return rows;
  }

  interface Scenario {
    template: SignupTemplate['fields'];
    slots: SignupTemplate['slots'];
    settings?: Record<string, unknown>;
    /** Anything the template can't say, such as a closed slot. */
    setup?: (s: Snapshot) => Promise<void>;
    request: (s: Snapshot) => DraftFixRequest;
    done: string;
    /** What the fix changed. */
    fixed: (after: Snapshot) => void;
  }

  const SCENARIOS: Record<DraftFixKind, Scenario> = {
    // An empty date field that both anchors reminders and groups the page.
    empty_field: {
      template: [
        text('what', 'What', 0),
        dateField('when', 'When', 1),
        dateField('date', 'Date', 2),
      ],
      slots: [
        { capacity: 1, values: { what: 'Setup', date: '2030-11-14' }, sortOrder: 0 },
        { capacity: 1, values: { what: 'Till', date: '2030-11-15' }, sortOrder: 1 },
      ],
      settings: { groupByFieldRefs: ['when'], reminderFromFieldRef: 'when' },
      request: (s) => ({ kind: 'empty_field', fieldId: s.ids.fields[1]! }),
      done: 'Removed “When”.',
      fixed: (after) => {
        expect(after.fields.map((f) => f.ref)).toEqual(['what', 'date']);
        expect(after.settings.groupByFieldRefs).toEqual([]);
        expect(after.settings.reminderFromFieldRef).toBe('date');
        expect(after.slots.map((s) => s.slotAt)).toEqual([
          '2030-11-14T12:00:00.000Z',
          '2030-11-15T12:00:00.000Z',
        ]);
      },
    },
    // Two blank slots between filled ones, one of them closed.
    blank_slot: {
      template: [text('what', 'What', 0), dateField('date', 'Date', 1)],
      slots: [
        { capacity: 1, values: { what: 'Setup', date: '2030-11-14' }, sortOrder: 0 },
        { capacity: null, values: {}, sortOrder: 1 },
        { capacity: 2, values: { what: 'Till' }, sortOrder: 2 },
        { capacity: 3, values: { what: '' }, sortOrder: 3 },
      ],
      setup: async (s) => {
        const closed = await updateSlot(db, owner, s.ids.slots[3]!, { status: 'closed' });
        if (!closed.ok) throw new Error(closed.error.message);
      },
      request: (s) => ({ kind: 'blank_slot', slotIds: [s.ids.slots[1]!, s.ids.slots[3]!] }),
      done: 'Removed 2 empty slots.',
      fixed: (after) => {
        expect(after.slots.map((s) => s.values)).toEqual([
          { what: 'Setup', date: '2030-11-14' },
          { what: 'Till' },
        ]);
      },
    },
    unnamed_field: {
      template: [text('what', 'What', 0), text('role', 'Untitled', 1)],
      slots: [{ capacity: 1, values: { what: 'Setup', role: 'Lead' }, sortOrder: 0 }],
      request: (s) => ({
        kind: 'unnamed_field',
        fieldId: s.ids.fields[1]!,
        label: '  Shift lead ',
      }),
      done: 'Named the field “Shift lead”.',
      fixed: (after) => {
        expect(after.fields.map((f) => f.label)).toEqual(['What', 'Shift lead']);
      },
    },
    ungrouped_dates: {
      template: [text('what', 'What', 0), dateField('date', 'Date', 1)],
      slots: [
        { capacity: 1, values: { what: 'Setup', date: '2030-11-14' }, sortOrder: 0 },
        { capacity: 1, values: { what: 'Till', date: '2030-11-14' }, sortOrder: 1 },
        { capacity: 1, values: { what: 'Setup', date: '2030-11-15' }, sortOrder: 2 },
        { capacity: 1, values: { what: 'Till', date: '2030-11-15' }, sortOrder: 3 },
      ],
      request: (s) => ({ kind: 'ungrouped_dates', fieldId: s.ids.fields[1]! }),
      done: 'Grouped the slots by “Date”.',
      fixed: (after) => {
        expect(after.settings.groupByFieldRefs).toEqual(['date']);
      },
    },
    // Numbered rows after another slot: merged into one "Helper" slot that
    // takes all their places, its number dropped.
    duplicate_slots: {
      template: [text('what', 'What', 0), dateField('date', 'Date', 1)],
      slots: [
        { capacity: 2, values: { what: 'Setup', date: '2030-11-14' }, sortOrder: 0 },
        { capacity: 1, values: { what: 'Helper 1', date: '2030-11-14' }, sortOrder: 1 },
        { capacity: 1, values: { what: 'Helper 2', date: '2030-11-14' }, sortOrder: 2 },
        { capacity: 1, values: { what: 'Helper 3', date: '2030-11-14' }, sortOrder: 3 },
      ],
      request: (s) => ({ kind: 'duplicate_slots', slotIds: s.ids.slots.slice(1) }),
      done: 'Merged 3 slots into one for 3 people.',
      fixed: (after) => {
        expect(after.slots.map(({ values, capacity }) => ({ values, capacity }))).toEqual([
          { values: { what: 'Setup', date: '2030-11-14' }, capacity: 2 },
          { values: { what: 'Helper', date: '2030-11-14' }, capacity: 3 },
        ]);
      },
    },
  };

  async function draftFor(scenario: Scenario): Promise<{ id: string; before: Snapshot }> {
    const created = await createSignup(
      db,
      owner,
      workspaceId,
      {
        title: 'Fix test',
        description: '',
        tags: [],
        visibility: 'unlisted',
        settings: scenario.settings ?? {},
      },
      { template: { id: 'test', fields: [...scenario.template], slots: scenario.slots } },
    );
    if (!created.ok) throw new Error(created.error.message);
    const id = created.value.id;
    await scenario.setup?.(await snapshot(id));
    return { id, before: await snapshot(id) };
  }

  for (const [kind, scenario] of Object.entries(SCENARIOS) as [DraftFixKind, Scenario][]) {
    describe(kind, () => {
      it('fixes it and logs the kind; Undo puts back everything it changed', async () => {
        const { id, before } = await draftFor(scenario);

        const applied = await applyDraftFixAction(id, scenario.request(before));
        if ('error' in applied) throw new Error(applied.error);
        expect(applied.done).toBe(scenario.done);
        expect(applied.undo.kind).toBe(kind);
        expect(revalidatePath).toHaveBeenCalledWith(`/app/signups/${id}`, 'layout');
        scenario.fixed(await snapshot(id));
        expect(await events(id, 'review.notice_accepted')).toEqual([
          { payload: { kind }, actorId: organizerId },
        ]);

        // The undo goes to the browser and back as plain data.
        const undo = JSON.parse(JSON.stringify(applied.undo)) as DraftFixUndo;
        revalidatePath.mockClear();
        expect(await undoDraftFixAction(id, undo)).toBeNull();
        expect(revalidatePath).toHaveBeenCalledWith(`/app/signups/${id}`, 'layout');
        expect(withoutIds(await snapshot(id))).toEqual(withoutIds(before));
        expect(await events(id, 'review.fix_undone')).toEqual([
          { payload: { kind }, actorId: organizerId },
        ]);
      });

      it('changes nothing for a problem already fixed', async () => {
        const { id, before } = await draftFor(scenario);
        const request = scenario.request(before);
        const first = await applyDraftFixAction(id, request);
        expect(first).not.toHaveProperty('error');
        const fixed = await snapshot(id);
        revalidatePath.mockClear();

        // A second tap, a stale page, or an AI assistant that got there first.
        expect(await applyDraftFixAction(id, request)).toEqual({
          error: 'That changed since you opened this page, so nothing was done.',
        });
        expect(await snapshot(id)).toEqual(fixed);
        expect(await events(id, 'review.notice_accepted')).toHaveLength(1);
        // The page comes back as it is now.
        expect(revalidatePath).toHaveBeenCalled();
      });

      it('refuses a viewer in plain words and changes nothing', async () => {
        const { id, before } = await draftFor(scenario);
        session.actor = viewer;
        expect(await applyDraftFixAction(id, scenario.request(before))).toEqual({
          error: 'You don’t have edit access.',
        });
        expect(await snapshot(id)).toEqual(before);
        expect(await events(id, 'review.notice_accepted')).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
      });

      it('refuses a signup that is published', async () => {
        const { id, before } = await draftFor(scenario);
        const published = await publishSignup(db, owner, id);
        if (!published.ok) throw new Error(published.error.message);
        expect(await applyDraftFixAction(id, scenario.request(before))).toEqual({
          error: 'This signup isn’t a draft any more. Change it in the builder.',
        });
        expect(await snapshot(id)).toEqual({ ...before, status: 'open' });
        expect(await events(id, 'review.notice_accepted')).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
      });
    });
  }

  it('won’t undo a field renamed again since, and says so', async () => {
    const scenario = SCENARIOS.unnamed_field;
    const { id, before } = await draftFor(scenario);
    const applied = await applyDraftFixAction(id, scenario.request(before));
    if ('error' in applied) throw new Error(applied.error);
    const renamed = await updateField(db, owner, before.ids.fields[1]!, { label: 'Role' });
    if (!renamed.ok) throw new Error(renamed.error.message);
    const changed = await snapshot(id);

    expect(await undoDraftFixAction(id, applied.undo)).toEqual({
      error: 'That changed again since, so it can’t be undone.',
    });
    expect(await snapshot(id)).toEqual(changed);
    expect(await events(id, 'review.fix_undone')).toHaveLength(0);
  });

  it('won’t undo on another signup, or after the signup is published', async () => {
    const scenario = SCENARIOS.unnamed_field;
    const { id, before } = await draftFor(scenario);
    const other = await draftFor(scenario);
    const applied = await applyDraftFixAction(id, scenario.request(before));
    if ('error' in applied) throw new Error(applied.error);

    // The undo names a field of the first signup, which the second lacks.
    expect(await undoDraftFixAction(other.id, applied.undo)).toEqual({
      error: 'That changed again since, so it can’t be undone.',
    });
    expect(await snapshot(other.id)).toEqual(other.before);

    const published = await publishSignup(db, owner, id);
    if (!published.ok) throw new Error(published.error.message);
    const open = await snapshot(id);
    expect(await undoDraftFixAction(id, applied.undo)).toEqual({
      error: 'This signup isn’t a draft any more. Change it in the builder.',
    });
    expect(await snapshot(id)).toEqual(open);
  });

  it('refuses a name that is blank or still the default, and keeps the field as it was', async () => {
    const scenario = SCENARIOS.unnamed_field;
    const { id, before } = await draftFor(scenario);
    const fieldId = before.ids.fields[1]!;
    expect(await applyDraftFixAction(id, { kind: 'unnamed_field', fieldId, label: '   ' })).toEqual(
      { error: 'Type a name for the field.' },
    );
    expect(
      await applyDraftFixAction(id, { kind: 'unnamed_field', fieldId, label: ' untitled ' }),
    ).toEqual({ error: 'Give it a name other than “Untitled”.' });
    expect(await snapshot(id)).toEqual(before);
    expect(await events(id, 'review.notice_accepted')).toHaveLength(0);
  });

  it('undoes a merge even after a copy of the merged slot was added since', async () => {
    const scenario = SCENARIOS.duplicate_slots;
    const { id, before } = await draftFor(scenario);
    const applied = await applyDraftFixAction(id, scenario.request(before));
    if ('error' in applied) throw new Error(applied.error);
    const copy = await addSlot(db, owner, id, {
      values: { what: 'Helper', date: '2030-11-14' },
      capacity: 3,
    });
    if (!copy.ok) throw new Error(copy.error.message);

    expect(await undoDraftFixAction(id, applied.undo)).toBeNull();
    // Every slot back, and the new copy kept. The copy took the next place
    // free, which a slot put back shares, so the order of those two is the
    // order they were made in.
    const rows = (s: Snapshot) =>
      s.slots.map(({ values, capacity }) => JSON.stringify({ values, capacity })).sort();
    expect(rows(await snapshot(id))).toEqual(
      [
        ...rows(before),
        // In the key order the database gives back.
        JSON.stringify({ values: { date: '2030-11-14', what: 'Helper' }, capacity: 3 }),
      ].sort(),
    );
  });

  it('keeps the merged slot when undo finds its places changed since, and says so', async () => {
    const scenario = SCENARIOS.duplicate_slots;
    const { id, before } = await draftFor(scenario);
    const applied = await applyDraftFixAction(id, scenario.request(before));
    if ('error' in applied) throw new Error(applied.error);
    const kept = before.ids.slots[1]!;
    const edited = await updateSlot(db, owner, kept, { capacity: 10 });
    if (!edited.ok) throw new Error(edited.error.message);
    const changed = await snapshot(id);

    expect(await undoDraftFixAction(id, applied.undo)).toEqual({
      error: 'That changed again since, so it can’t be undone.',
    });
    expect(await snapshot(id)).toEqual(changed);
    expect(await events(id, 'review.fix_undone')).toHaveLength(0);
  });

  it('merges copies with no limit as one with no limit, and undoes it only once', async () => {
    const { id, before } = await draftFor({
      ...SCENARIOS.duplicate_slots,
      slots: [
        { capacity: null, values: { what: 'Snacks', date: '2030-11-14' }, sortOrder: 0 },
        { capacity: 2, values: { what: 'Snacks', date: '2030-11-14' }, sortOrder: 1 },
        { capacity: 1, values: { what: 'Setup', date: '2030-11-14' }, sortOrder: 2 },
      ],
    });
    const applied = await applyDraftFixAction(id, {
      kind: 'duplicate_slots',
      slotIds: before.ids.slots.slice(0, 2),
    });
    if ('error' in applied) throw new Error(applied.error);
    expect(applied.done).toBe('Merged 2 slots into one with no limit.');
    expect(
      (await snapshot(id)).slots.map(({ values, capacity }) => ({ values, capacity })),
    ).toEqual([
      { values: { what: 'Snacks', date: '2030-11-14' }, capacity: null },
      { values: { what: 'Setup', date: '2030-11-14' }, capacity: 1 },
    ]);

    expect(await undoDraftFixAction(id, applied.undo)).toBeNull();
    const undone = await snapshot(id);
    expect(withoutIds(undone)).toEqual(withoutIds(before));
    // Sent again, as after an answer that never arrived: the kept slot has no
    // limit either way, so it's the copies being back that refuse it.
    expect(await undoDraftFixAction(id, applied.undo)).toEqual({
      error: 'That changed again since, so it can’t be undone.',
    });
    expect(await snapshot(id)).toEqual(undone);
    expect(await events(id, 'review.fix_undone')).toHaveLength(1);
  });

  it('removes empty slots all together, in one transaction logged once', async () => {
    const scenario = SCENARIOS.blank_slot;
    const { id, before } = await draftFor(scenario);
    const applied = await applyDraftFixAction(id, scenario.request(before));
    expect(applied).toMatchObject({ done: 'Removed 2 empty slots.' });
    expect(await events(id, 'slot.deleted')).toEqual([
      {
        payload: {
          bulk: true,
          count: 2,
          slotIds: [before.ids.slots[1], before.ids.slots[3]],
          commitmentsRemoved: 0,
          places: 0,
        },
        actorId: organizerId,
      },
    ]);
  });

  // Remove day (#504): every slot of one date's group on a page grouped by
  // date, through the same Undo.
  describe('removeDayAction', () => {
    // Two days, their slots interleaved, one of Sat, Apr 6's closed, and a
    // slot with no date, which is no day.
    const week: Scenario = {
      template: [text('what', 'What', 0), dateField('date', 'Date', 1), text('notes', 'Notes', 2)],
      slots: [
        { capacity: 2, values: { what: 'Setup', date: '2030-04-06', notes: 'Gym' }, sortOrder: 0 },
        { capacity: 1, values: { what: 'Till', date: '2030-04-13' }, sortOrder: 1 },
        { capacity: null, values: { what: 'Cleanup', date: '2030-04-06' }, sortOrder: 2 },
        { capacity: 3, values: { what: 'Snacks', date: '2030-04-06' }, sortOrder: 3 },
        { capacity: 1, values: { what: 'Raffle' }, sortOrder: 4 },
      ],
      settings: { groupByFieldRefs: ['date'] },
      setup: async (s) => {
        const closed = await updateSlot(db, owner, s.ids.slots[2]!, { status: 'closed' });
        if (!closed.ok) throw new Error(closed.error.message);
      },
      // Unused: Remove day sends its own request.
      request: () => {
        throw new Error('not a fix');
      },
      done: '',
      fixed: () => {},
    };
    /** What the page sends for the day `value` holding these slots. */
    const day = (value: string, slotIds: string[], ref = 'date'): RemoveDayRequest => ({
      kind: 'remove_day',
      ref,
      value,
      fingerprint: slotSetFingerprint(slotIds),
    });
    const SAT_APR_6 = [0, 2, 3];
    const sat = (s: Snapshot) =>
      day(
        '2030-04-06',
        SAT_APR_6.map((i) => s.ids.slots[i]!),
      );
    const stale = { error: 'That changed since you opened this page, so nothing was done.' };
    const changedAgain = { error: 'That changed again since, so it can’t be undone.' };

    it('removes the day and its slots; Undo puts them back as they were', async () => {
      const { id, before } = await draftFor(week);

      const removed = await removeDayAction(id, sat(before));
      if ('error' in removed) throw new Error(removed.error);
      expect(removed.done).toBe('Removed Sat, Apr 6 and its 3 slots.');
      expect(removed.undo.kind).toBe('remove_day');
      expect(revalidatePath).toHaveBeenCalledWith(`/app/signups/${id}`, 'layout');
      const after = await snapshot(id);
      expect(after.slots.map((s) => s.values)).toEqual([
        { what: 'Till', date: '2030-04-13' },
        { what: 'Raffle' },
      ]);
      // One row for the slots, deleted together, and one saying the page
      // did it; not a notice's fix.
      expect(await events(id, 'slot.deleted')).toEqual([
        {
          payload: {
            bulk: true,
            count: 3,
            slotIds: SAT_APR_6.map((i) => before.ids.slots[i]),
            commitmentsRemoved: 0,
            places: 0,
          },
          actorId: organizerId,
        },
      ]);
      expect(await events(id, 'review.slots_edited')).toEqual([
        { payload: { kind: 'remove_day' }, actorId: organizerId },
      ]);
      expect(await events(id, 'review.notice_accepted')).toHaveLength(0);

      // The undo goes to the browser and back as plain data.
      const undo = JSON.parse(JSON.stringify(removed.undo)) as DraftFixUndo;
      revalidatePath.mockClear();
      expect(await undoDraftFixAction(id, undo)).toBeNull();
      expect(revalidatePath).toHaveBeenCalledWith(`/app/signups/${id}`, 'layout');
      // Values, places, order and the closed slot closed again.
      expect(withoutIds(await snapshot(id))).toEqual(withoutIds(before));
      expect(await events(id, 'review.fix_undone')).toEqual([
        { payload: { kind: 'remove_day' }, actorId: organizerId },
      ]);
    });

    it('says a day of one slot as one', async () => {
      const { id, before } = await draftFor(week);
      const removed = await removeDayAction(id, day('2030-04-13', [before.ids.slots[1]!]));
      expect(removed).toMatchObject({ done: 'Removed Sat, Apr 13 and its slot.' });
    });

    it('removes nothing once a slot moved out of the day, or one was added to it', async () => {
      const moved = await draftFor(week);
      const edited = await updateSlot(db, owner, moved.before.ids.slots[3]!, {
        values: { what: 'Snacks', date: '2030-04-13' },
      });
      if (!edited.ok) throw new Error(edited.error.message);
      const movedNow = await snapshot(moved.id);
      revalidatePath.mockClear();
      expect(await removeDayAction(moved.id, sat(moved.before))).toEqual(stale);
      expect(await snapshot(moved.id)).toEqual(movedNow);
      // The page comes back as it is now.
      expect(revalidatePath).toHaveBeenCalled();

      // An AI assistant adds a slot to that day meanwhile.
      const added = await draftFor(week);
      const extra = await addSlot(db, owner, added.id, {
        values: { what: 'Music', date: '2030-04-06' },
        capacity: 1,
      });
      if (!extra.ok) throw new Error(extra.error.message);
      const addedNow = await snapshot(added.id);
      expect(await removeDayAction(added.id, sat(added.before))).toEqual(stale);
      expect(await snapshot(added.id)).toEqual(addedNow);
      expect(await events(added.id, 'slot.deleted')).toHaveLength(0);
      expect(await events(added.id, 'review.slots_edited')).toHaveLength(0);
    });

    it('removes nothing a second time', async () => {
      const { id, before } = await draftFor(week);
      expect(await removeDayAction(id, sat(before))).not.toHaveProperty('error');
      const removed = await snapshot(id);
      expect(await removeDayAction(id, sat(before))).toEqual(stale);
      expect(await snapshot(id)).toEqual(removed);
    });

    it('undoes it only once', async () => {
      const { id, before } = await draftFor(week);
      const removed = await removeDayAction(id, sat(before));
      if ('error' in removed) throw new Error(removed.error);
      expect(await undoDraftFixAction(id, removed.undo)).toBeNull();
      const undone = await snapshot(id);
      // Sent again, as after an answer that never arrived.
      expect(await undoDraftFixAction(id, removed.undo)).toEqual(changedAgain);
      expect(await snapshot(id)).toEqual(undone);
      expect(await events(id, 'review.fix_undone')).toHaveLength(1);
    });

    it('won’t undo once the day was added again since, or its date field is gone', async () => {
      const readded = await draftFor(week);
      const removed = await removeDayAction(readded.id, sat(readded.before));
      if ('error' in removed) throw new Error(removed.error);
      const again = await addSlot(db, owner, readded.id, {
        values: { what: 'Setup', date: '2030-04-06' },
        capacity: 2,
      });
      if (!again.ok) throw new Error(again.error.message);
      const readdedNow = await snapshot(readded.id);
      expect(await undoDraftFixAction(readded.id, removed.undo)).toEqual(changedAgain);
      expect(await snapshot(readded.id)).toEqual(readdedNow);

      const dropped = await draftFor(week);
      const gone = await removeDayAction(dropped.id, sat(dropped.before));
      if ('error' in gone) throw new Error(gone.error);
      const deleted = await deleteField(db, owner, dropped.before.ids.fields[1]!);
      if (!deleted.ok) throw new Error(deleted.error.message);
      const droppedNow = await snapshot(dropped.id);
      expect(await undoDraftFixAction(dropped.id, gone.undo)).toEqual(changedAgain);
      expect(await snapshot(dropped.id)).toEqual(droppedNow);
      expect(await events(dropped.id, 'review.fix_undone')).toHaveLength(0);
    });

    it('refuses a viewer in plain words and removes nothing', async () => {
      const { id, before } = await draftFor(week);
      session.actor = viewer;
      expect(await removeDayAction(id, sat(before))).toEqual({
        error: 'You don’t have edit access.',
      });
      expect(await snapshot(id)).toEqual(before);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('refuses a signup that is published', async () => {
      const { id, before } = await draftFor(week);
      const published = await publishSignup(db, owner, id);
      if (!published.ok) throw new Error(published.error.message);
      expect(await removeDayAction(id, sat(before))).toEqual({
        error: 'This signup isn’t a draft any more. Change it in the builder.',
      });
      expect(await snapshot(id)).toEqual({ ...before, status: 'open' });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('removes nothing on a page that isn’t grouped by a date', async () => {
      const ungrouped = await draftFor({ ...week, settings: {} });
      expect(await removeDayAction(ungrouped.id, sat(ungrouped.before))).toEqual(stale);
      expect(await snapshot(ungrouped.id)).toEqual(ungrouped.before);

      // Grouped by "What", a text field: no group is a day.
      const byWhat = await draftFor(week);
      const regrouped = await updateSignup(db, owner, byWhat.id, {
        settings: { groupByFieldRefs: ['what'] },
      });
      if (!regrouped.ok) throw new Error(regrouped.error.message);
      const byWhatNow = await snapshot(byWhat.id);
      expect(
        await removeDayAction(byWhat.id, day('Setup', [byWhat.before.ids.slots[0]!], 'what')),
      ).toEqual(stale);
      expect(await snapshot(byWhat.id)).toEqual(byWhatNow);
    });

    it('removes nothing that would leave no slot filled in', async () => {
      // One day, and a slot with nothing in it: the page wouldn't offer it.
      const { id, before } = await draftFor({
        ...week,
        slots: [
          { capacity: 1, values: { what: 'Setup', date: '2030-04-06' }, sortOrder: 0 },
          { capacity: 1, values: {}, sortOrder: 1 },
        ],
        setup: undefined,
      });
      expect(await removeDayAction(id, day('2030-04-06', [before.ids.slots[0]!]))).toEqual(stale);
      expect(await snapshot(id)).toEqual(before);
    });

    it('refuses a request it can’t read, and removes nothing', async () => {
      const { id, before } = await draftFor(week);
      expect(await removeDayAction(id, { ...sat(before), fingerprint: '' })).toEqual({
        error: 'Couldn’t remove that day. Try again.',
      });
      expect(await snapshot(id)).toEqual(before);
    });
  });

  // People for each slot (#504): every slot's capacity at once, through the
  // same Undo.
  describe('setCapacityAction', () => {
    // One slot for 1, one for 3, one with no limit, one of them closed.
    const mixed: Scenario = {
      template: [text('what', 'What', 0), dateField('date', 'Date', 1)],
      slots: [
        { capacity: 1, values: { what: 'Setup', date: '2030-04-06' }, sortOrder: 0 },
        { capacity: 3, values: { what: 'Till', date: '2030-04-06' }, sortOrder: 1 },
        { capacity: null, values: { what: 'Cleanup', date: '2030-04-13' }, sortOrder: 2 },
      ],
      setup: async (s) => {
        const closed = await updateSlot(db, owner, s.ids.slots[1]!, { status: 'closed' });
        if (!closed.ok) throw new Error(closed.error.message);
      },
      // Unused: People for each slot sends its own request.
      request: () => {
        throw new Error('not a fix');
      },
      done: '',
      fixed: () => {},
    };
    /** What the page sends for these slots, every one of the draft's. */
    const each = (capacity: number, s: Snapshot): SetCapacityRequest => ({
      kind: 'set_capacity',
      capacity,
      fingerprint: slotSetFingerprint(s.ids.slots),
    });
    const capacities = async (id: string) => (await snapshot(id)).slots.map((s) => s.capacity);
    const stale = { error: 'That changed since you opened this page, so nothing was done.' };
    const changedAgain = { error: 'That changed again since, so it can’t be undone.' };

    it('sets every slot; Undo puts back each one it changed', async () => {
      const { id, before } = await draftFor(mixed);

      const set = await setCapacityAction(id, each(3, before));
      if ('error' in set) throw new Error(set.error);
      expect(set.done).toBe('Set every slot to 3 people.');
      expect(set.undo?.kind).toBe('set_capacity');
      expect(revalidatePath).toHaveBeenCalledWith(`/app/signups/${id}`, 'layout');
      expect(await capacities(id)).toEqual([3, 3, 3]);
      // One row for the slots that changed, and one saying the page did it;
      // not a notice's fix.
      expect(await events(id, 'slot.updated')).toContainEqual({
        payload: {
          bulk: true,
          slotIds: [before.ids.slots[0], before.ids.slots[2]],
          changed: ['capacity'],
        },
        actorId: organizerId,
      });
      expect(
        (await events(id, 'slot.updated')).filter((e) => 'bulk' in (e.payload as object)),
      ).toHaveLength(1);
      expect(await events(id, 'review.slots_edited')).toEqual([
        { payload: { kind: 'set_capacity' }, actorId: organizerId },
      ]);
      expect(await events(id, 'review.notice_accepted')).toHaveLength(0);

      // The undo goes to the browser and back as plain data.
      const undo = JSON.parse(JSON.stringify(set.undo)) as DraftFixUndo;
      revalidatePath.mockClear();
      expect(await undoDraftFixAction(id, undo)).toBeNull();
      expect(revalidatePath).toHaveBeenCalledWith(`/app/signups/${id}`, 'layout');
      expect(await snapshot(id)).toEqual(before);
      expect(await events(id, 'review.fix_undone')).toEqual([
        { payload: { kind: 'set_capacity' }, actorId: organizerId },
      ]);
    });

    it('says one person as one', async () => {
      const { id, before } = await draftFor(mixed);
      expect(await setCapacityAction(id, each(1, before))).toMatchObject({
        done: 'Set every slot to 1 person.',
      });
      expect(await capacities(id)).toEqual([1, 1, 1]);
    });

    it('writes nothing, and offers no Undo, when every slot already takes that number', async () => {
      const { id, before } = await draftFor({
        ...mixed,
        slots: mixed.slots.map((slot) => ({ ...slot, capacity: 2 })),
      });
      expect(await setCapacityAction(id, each(2, before))).toEqual({
        done: 'Every slot is already for 2 people.',
        undo: null,
      });
      expect(await snapshot(id)).toEqual(before);
      // Only the setup's close.
      expect(await events(id, 'slot.updated')).toHaveLength(1);
      expect(await events(id, 'review.slots_edited')).toHaveLength(0);
    });

    it('sets nothing once a slot was added or deleted since', async () => {
      const added = await draftFor(mixed);
      const extra = await addSlot(db, owner, added.id, {
        values: { what: 'Music', date: '2030-04-06' },
        capacity: 1,
      });
      if (!extra.ok) throw new Error(extra.error.message);
      const addedNow = await snapshot(added.id);
      revalidatePath.mockClear();
      expect(await setCapacityAction(added.id, each(4, added.before))).toEqual(stale);
      expect(await snapshot(added.id)).toEqual(addedNow);
      // The page comes back as it is now.
      expect(revalidatePath).toHaveBeenCalled();
      expect(await events(added.id, 'review.slots_edited')).toHaveLength(0);

      const deleted = await draftFor(mixed);
      const gone = await deleteDraftSlots(db, owner, deleted.id, {
        slotIds: [deleted.before.ids.slots[2]!],
      });
      if (!gone.ok) throw new Error(gone.error.message);
      const deletedNow = await snapshot(deleted.id);
      expect(await setCapacityAction(deleted.id, each(4, deleted.before))).toEqual(stale);
      expect(await snapshot(deleted.id)).toEqual(deletedNow);
    });

    it('won’t undo once a slot it changed takes another number since', async () => {
      const { id, before } = await draftFor(mixed);
      const set = await setCapacityAction(id, each(4, before));
      if ('error' in set || !set.undo) throw new Error('not set');
      // Opened on the page, in the builder, or by an AI assistant.
      const edited = await updateSlot(db, owner, before.ids.slots[2]!, { capacity: 6 });
      if (!edited.ok) throw new Error(edited.error.message);
      const changed = await snapshot(id);

      expect(await undoDraftFixAction(id, set.undo)).toEqual(changedAgain);
      expect(await snapshot(id)).toEqual(changed);
      expect(await events(id, 'review.fix_undone')).toHaveLength(0);
    });

    it('undoes it only once', async () => {
      const { id, before } = await draftFor(mixed);
      const set = await setCapacityAction(id, each(4, before));
      if ('error' in set || !set.undo) throw new Error('not set');
      expect(await undoDraftFixAction(id, set.undo)).toBeNull();
      const undone = await snapshot(id);
      // Sent again, as after an answer that never arrived.
      expect(await undoDraftFixAction(id, set.undo)).toEqual(changedAgain);
      expect(await snapshot(id)).toEqual(undone);
      expect(await events(id, 'review.fix_undone')).toHaveLength(1);
    });

    it('refuses a number that isn’t a whole number of people, and sets nothing', async () => {
      const { id, before } = await draftFor(mixed);
      for (const capacity of [0, -2, 2.5, Number.NaN, 3_000_000_000]) {
        expect(await setCapacityAction(id, each(capacity, before))).toEqual({
          error: 'Type a whole number of people, 1 or more.',
        });
      }
      expect(await snapshot(id)).toEqual(before);
      expect(await events(id, 'review.slots_edited')).toHaveLength(0);
    });

    it('refuses a viewer in plain words and sets nothing', async () => {
      const { id, before } = await draftFor(mixed);
      session.actor = viewer;
      expect(await setCapacityAction(id, each(4, before))).toEqual({
        error: 'You don’t have edit access.',
      });
      expect(await snapshot(id)).toEqual(before);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('refuses a signup that is published, and its Undo too', async () => {
      const { id, before } = await draftFor(mixed);
      const set = await setCapacityAction(id, each(4, before));
      if ('error' in set || !set.undo) throw new Error('not set');
      const published = await publishSignup(db, owner, id);
      if (!published.ok) throw new Error(published.error.message);
      const open = await snapshot(id);
      revalidatePath.mockClear();
      const notDraft = { error: 'This signup isn’t a draft any more. Change it in the builder.' };
      expect(await setCapacityAction(id, each(2, open))).toEqual(notDraft);
      expect(await undoDraftFixAction(id, set.undo)).toEqual(notDraft);
      expect(await snapshot(id)).toEqual(open);
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  it('refuses an undo it can’t read, and changes nothing', async () => {
    const scenario = SCENARIOS.ungrouped_dates;
    const { id, before } = await draftFor(scenario);
    expect(
      await undoDraftFixAction(id, { kind: 'ungrouped_dates', ref: '' } as unknown as DraftFixUndo),
    ).toEqual({ error: 'Couldn’t undo that. Change it in the builder.' });
    expect(await snapshot(id)).toEqual(before);
  });
});
