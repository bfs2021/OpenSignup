import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { activity } from '@/db/schema/activity';
import { workspaceMembers } from '@/db/schema/members';
import { organizers } from '@/db/schema/organizers';
import { workspaces } from '@/db/schema/workspaces';
import { makeId } from '@/lib/ids';
import type { Actor } from '@/lib/policy';
import { commitToSlot } from '@/services/commitments';
import { createSignup, deleteSignup, publishSignup } from '@/services/signups';
import { listSlotsForSignup, updateSlotCapacities } from '@/services/slots';
import { settle, untilServiceBlockedOn, whileSigningUp } from '@/services/testing/locks';

interface Fixture {
  db: Db;
  workspaceId: string;
  actor: Extract<Actor, { kind: 'organizer' }>;
}

async function setupWorkspace(): Promise<Fixture> {
  const db = getDb();
  const workspaceId = makeId('ws');
  const id = makeId('org');
  const email = `capacities-${id.slice(-8).toLowerCase()}@example.test`;
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `test-${workspaceId.slice(-8).toLowerCase()}`,
    name: 'Test Workspace',
    type: 'personal',
    plan: 'free',
  });
  await db.insert(organizers).values({ id, email, name: 'Test Org' });
  await db.insert(workspaceMembers).values({
    id: makeId('mem'),
    workspaceId,
    organizerId: id,
    role: 'owner',
    status: 'active',
  });
  return {
    db,
    workspaceId,
    actor: {
      kind: 'organizer',
      id,
      email,
      workspaceIds: [workspaceId],
      workspaceRoles: { [workspaceId]: 'owner' },
    },
  };
}

async function teardownWorkspace(fx: Fixture): Promise<void> {
  await fx.db.delete(workspaces).where(eq(workspaces.id, fx.workspaceId));
  await fx.db.delete(organizers).where(eq(organizers.id, fx.actor.id));
}

/**
 * A draft with a `what` text field and one slot per capacity, named a, b, c…
 * and shown in the order given. Returns the slot ids in that order.
 */
async function makeSignup(fx: Fixture, title: string, capacities: (number | null)[]) {
  const created = await createSignup(
    fx.db,
    fx.actor,
    fx.workspaceId,
    { title },
    {
      template: {
        id: 'capacities-test',
        fields: [
          {
            ref: 'what',
            label: 'What',
            fieldType: 'text',
            sortOrder: 0,
            config: { fieldType: 'text', maxLength: 200 },
          },
        ],
        slots: capacities.map((capacity, sortOrder) => ({
          values: { what: String.fromCharCode(97 + sortOrder) },
          capacity,
          sortOrder,
        })),
      },
    },
  );
  if (!created.ok) throw new Error(`createSignup failed: ${created.error.message}`);
  const signupId = created.value.id;
  const ids = (await listSlotsForSignup(fx.db, signupId)).map((s) => s.id);
  return { signupId, ids };
}

/** The slots' capacities, in the order they are shown. */
async function capacitiesOf(fx: Fixture, signupId: string) {
  return (await listSlotsForSignup(fx.db, signupId)).map((s) => s.capacity);
}

async function updatedTimes(fx: Fixture, signupId: string) {
  return (await listSlotsForSignup(fx.db, signupId)).map((s) => s.updatedAt.toISOString());
}

async function slotUpdates(fx: Fixture, signupId: string) {
  return fx.db
    .select()
    .from(activity)
    .where(and(eq(activity.signupId, signupId), eq(activity.eventType, 'slot.updated')));
}

async function book(fx: Fixture, slotId: string, quantity: number, db: Db = fx.db) {
  const committed = await commitToSlot(db, slotId, {
    name: 'Pat Example',
    email: `pat-${makeId('par').slice(-6).toLowerCase()}@example.test`,
    quantity,
  });
  if (!committed.ok) throw new Error(`commitToSlot failed: ${committed.error.message}`);
}

describe('updateSlotCapacities (db)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await setupWorkspace();
  });

  afterAll(async () => {
    await teardownWorkspace(fx);
  });

  it('sets several capacities in one call, and records one slot.updated row', async () => {
    const {
      signupId,
      ids: [a, , c],
    } = await makeSignup(fx, 'Capacities several', [1, 1, 1]);
    const r = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: [
        { id: c!, capacity: 4 },
        { id: a!, capacity: 2 },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    // The slots sent, in the order they are shown, as they now stand.
    expect(r.value.slots.map((s) => [s.id, s.capacity])).toEqual([
      [a, 2],
      [c, 4],
    ]);
    expect(r.value.previous).toEqual([
      { id: c, capacity: 1 },
      { id: a, capacity: 1 },
    ]);
    expect(await capacitiesOf(fx, signupId)).toEqual([2, 1, 4]);

    const events = await slotUpdates(fx, signupId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ bulk: true, slotIds: [c, a], changed: ['capacity'] });
    expect(events[0]!.actorId).toBe(fx.actor.id);
  });

  it('stamps the connected app on the activity row for a change made through a token', async () => {
    const {
      signupId,
      ids: [a],
    } = await makeSignup(fx, 'Capacities via app', [1]);
    const viaApp: Actor = { ...fx.actor, via: { clientId: 'https://app.example.test/client' } };
    const r = await updateSlotCapacities(fx.db, viaApp, signupId, {
      slots: [{ id: a!, capacity: 6 }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [event] = await slotUpdates(fx, signupId);
    expect(event?.payload).toMatchObject({
      bulk: true,
      viaClientId: 'https://app.example.test/client',
    });
  });

  it('null sets no limit, and a limit can be set again', async () => {
    const {
      signupId,
      ids: [a, b],
    } = await makeSignup(fx, 'Capacities no limit', [3, 3]);
    const unlimited = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: [{ id: a!, capacity: null }],
    });
    expect(unlimited.ok, JSON.stringify(unlimited)).toBe(true);
    if (unlimited.ok) expect(unlimited.value.previous).toEqual([{ id: a, capacity: 3 }]);
    expect(await capacitiesOf(fx, signupId)).toEqual([null, 3]);

    const limited = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: [
        { id: a!, capacity: 5 },
        { id: b!, capacity: null },
      ],
    });
    expect(limited.ok, JSON.stringify(limited)).toBe(true);
    if (limited.ok) {
      expect(limited.value.previous).toEqual([
        { id: a, capacity: null },
        { id: b, capacity: 3 },
      ]);
    }
    expect(await capacitiesOf(fx, signupId)).toEqual([5, null]);
  });

  it('skips slots already at the capacity sent, and writes nothing when none changes', async () => {
    const {
      signupId,
      ids: [a, b, c],
    } = await makeSignup(fx, 'Capacities unchanged', [2, null, 4]);
    const before = await updatedTimes(fx, signupId);
    const sent = {
      slots: [
        { id: a!, capacity: 2 },
        { id: b!, capacity: null },
        { id: c!, capacity: 6 },
      ],
    };

    const r = await updateSlotCapacities(fx.db, fx.actor, signupId, sent);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.previous).toEqual([{ id: c, capacity: 4 }]);
    expect(r.value.slots.map((s) => s.capacity)).toEqual([2, null, 6]);
    const after = await updatedTimes(fx, signupId);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).not.toBe(before[2]);
    const events = await slotUpdates(fx, signupId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ slotIds: [c] });

    // The same again changes nothing: no write, and no second activity row.
    const again = await updateSlotCapacities(fx.db, fx.actor, signupId, sent);
    expect(again.ok, JSON.stringify(again)).toBe(true);
    if (!again.ok) return;
    expect(again.value.previous).toEqual([]);
    expect(again.value.slots.map((s) => [s.id, s.capacity])).toEqual([
      [a, 2],
      [b, null],
      [c, 6],
    ]);
    expect(await updatedTimes(fx, signupId)).toEqual(after);
    expect(await slotUpdates(fx, signupId)).toHaveLength(1);
  });

  it('refuses a slot that is not one of this signup, and changes nothing', async () => {
    const {
      signupId,
      ids: [a],
    } = await makeSignup(fx, 'Capacities refused', [1, 1]);
    const other = await makeSignup(fx, 'Capacities neighbour', [1]);
    const foreign = other.ids[0]!;
    for (const stranger of [foreign, 'slot_nope']) {
      const r = await updateSlotCapacities(fx.db, fx.actor, signupId, {
        slots: [
          { id: a!, capacity: 3 },
          { id: stranger, capacity: 3 },
        ],
      });
      expect(r.ok, stranger).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatchObject({
        code: 'invalid_input',
        field: 'slots',
        received: stranger,
        details: { unknown: [stranger] },
      });
      expect(r.error.message).toContain(stranger);
      expect(r.error.suggestion).toContain('reload');
    }
    expect(await capacitiesOf(fx, signupId)).toEqual([1, 1]);
    expect(await capacitiesOf(fx, other.signupId)).toEqual([1]);
    expect(await slotUpdates(fx, signupId)).toHaveLength(0);
    expect(await slotUpdates(fx, other.signupId)).toHaveLength(0);
  });

  it('refuses a list with a slot twice, none, or a capacity that is not a positive whole number', async () => {
    const {
      signupId,
      ids: [a],
    } = await makeSignup(fx, 'Capacities bad input', [1]);
    const cases: unknown[] = [
      { slots: [] },
      {
        slots: [
          { id: a, capacity: 2 },
          { id: a, capacity: 3 },
        ],
      },
      { slots: [{ id: a, capacity: 0 }] },
      { slots: [{ id: a, capacity: 2.5 }] },
      { slots: [{ id: a }] },
      { slots: [{ id: a, capacity: 2, status: 'closed' }] },
      { slots: [{ id: a, capacity: 2 }], force: true },
    ];
    for (const input of cases) {
      const r = await updateSlotCapacities(fx.db, fx.actor, signupId, input);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      if (!r.ok) expect(r.error.code, JSON.stringify(input)).toBe('invalid_input');
    }
    expect(await capacitiesOf(fx, signupId)).toEqual([1]);
    expect(await slotUpdates(fx, signupId)).toHaveLength(0);
  });

  it('refuses a capacity below the places a slot has taken, naming it, and changes nothing', async () => {
    const {
      signupId,
      ids: [a, b],
    } = await makeSignup(fx, 'Capacities booked', [5, 5]);
    const published = await publishSignup(fx.db, fx.actor, signupId);
    if (!published.ok) throw new Error(`publishSignup failed: ${published.error.message}`);
    await book(fx, b!, 3);

    const r = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: [
        { id: a!, capacity: 1 },
        { id: b!, capacity: 2 },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({
      code: 'conflict',
      field: 'capacity',
      received: 2,
      details: { slotId: b, taken: 3 },
      suggestion: 'cancel some commitments before lowering capacity',
    });
    expect(r.error.message).toContain(b);
    expect(r.error.message).toContain('active quantity (3)');
    // All or nothing: the slot nobody has booked keeps its capacity too.
    expect(await capacitiesOf(fx, signupId)).toEqual([5, 5]);
    expect(await slotUpdates(fx, signupId)).toHaveLength(0);

    // Exactly the places taken, or no limit, is fine.
    const exact = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: [
        { id: a!, capacity: 1 },
        { id: b!, capacity: 3 },
      ],
    });
    expect(exact.ok, JSON.stringify(exact)).toBe(true);
    expect(await capacitiesOf(fx, signupId)).toEqual([1, 3]);
    const unlimited = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: [{ id: b!, capacity: null }],
    });
    expect(unlimited.ok, JSON.stringify(unlimited)).toBe(true);
    expect(await capacitiesOf(fx, signupId)).toEqual([1, null]);
  });

  it('waits for someone signing up, and counts their place', async () => {
    const {
      signupId,
      ids: [a],
    } = await makeSignup(fx, 'Capacities during sign-up', [5]);
    const published = await publishSignup(fx.db, fx.actor, signupId);
    if (!published.ok) throw new Error(`publishSignup failed: ${published.error.message}`);
    let editing: ReturnType<typeof updateSlotCapacities> | undefined;
    const held = fx.db.transaction(async (tx) => {
      await book(fx, a!, 3, tx as unknown as Db);
      // Counts no one yet, since the sign-up has not committed.
      editing = updateSlotCapacities(fx.db, fx.actor, signupId, {
        slots: [{ id: a!, capacity: 2 }],
      });
      await untilServiceBlockedOn(fx.db, tx, editing);
    });
    await held.finally(() => settle(editing));
    const r = await editing!;
    expect(r.ok, JSON.stringify(r)).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('conflict');
      expect(r.error.message).toContain('active quantity (3)');
    }
    expect(await capacitiesOf(fx, signupId)).toEqual([5]);
  });

  it('does not deadlock with someone signing up for one of the slots', async () => {
    const {
      signupId,
      ids: [a, b],
    } = await makeSignup(fx, 'Capacities commit race', [5, 5]);
    const at = { signupId, workspaceId: fx.workspaceId, slotId: a! };
    const r = await whileSigningUp(fx.db, at, () =>
      updateSlotCapacities(fx.db, fx.actor, signupId, {
        slots: [
          { id: a!, capacity: 4 },
          { id: b!, capacity: 4 },
        ],
      }),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await capacitiesOf(fx, signupId)).toEqual([4, 4]);
  });

  it('refuses a viewer, and changes nothing', async () => {
    const {
      signupId,
      ids: [a],
    } = await makeSignup(fx, 'Capacities viewer', [1]);
    // requireWorkspaceWrite reads actor.workspaceRoles, so no member row is needed.
    const viewer: Actor = {
      kind: 'organizer',
      id: makeId('org'),
      email: 'viewer@example.test',
      workspaceIds: [fx.workspaceId],
      workspaceRoles: { [fx.workspaceId]: 'viewer' },
    };
    await expect(
      updateSlotCapacities(fx.db, viewer, signupId, { slots: [{ id: a!, capacity: 4 }] }),
    ).rejects.toMatchObject({ serviceError: { code: 'forbidden' } });
    expect(await capacitiesOf(fx, signupId)).toEqual([1]);
    expect(await slotUpdates(fx, signupId)).toHaveLength(0);
  });

  it('refuses a deleted signup, and one that does not exist, as not_found', async () => {
    const {
      signupId,
      ids: [a],
    } = await makeSignup(fx, 'Capacities deleted', [1]);
    const gone = await deleteSignup(fx.db, fx.actor, signupId);
    expect(gone.ok, JSON.stringify(gone)).toBe(true);
    const r = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: [{ id: a!, capacity: 4 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
    const none = await updateSlotCapacities(fx.db, fx.actor, 'sig_nope', {
      slots: [{ id: a!, capacity: 4 }],
    });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe('not_found');
    expect(await capacitiesOf(fx, signupId)).toEqual([1]);
    expect(await slotUpdates(fx, signupId)).toHaveLength(0);
  });

  it('queued behind a signup delete is not_found, and writes nothing', async () => {
    const {
      signupId,
      ids: [a],
    } = await makeSignup(fx, 'Capacities during delete', [1]);
    let editing: ReturnType<typeof updateSlotCapacities> | undefined;
    const held = fx.db.transaction(async (tx) => {
      const gone = await deleteSignup(tx as unknown as Db, fx.actor, signupId);
      expect(gone.ok, JSON.stringify(gone)).toBe(true);
      editing = updateSlotCapacities(fx.db, fx.actor, signupId, {
        slots: [{ id: a!, capacity: 4 }],
      });
      await untilServiceBlockedOn(fx.db, tx, editing);
    });
    await held.finally(() => settle(editing));
    const r = await editing!;
    expect(r.ok, JSON.stringify(r)).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
    expect(await capacitiesOf(fx, signupId)).toEqual([1]);
    expect(await slotUpdates(fx, signupId)).toHaveLength(0);
  });

  it('puts the slots back as they were when sent its own previous', async () => {
    const { signupId, ids } = await makeSignup(fx, 'Capacities round trip', [1, null, 3, 8]);
    const original = await capacitiesOf(fx, signupId);

    const set = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: ids.map((id) => ({ id, capacity: 3 })),
    });
    expect(set.ok, JSON.stringify(set)).toBe(true);
    if (!set.ok) return;
    expect(await capacitiesOf(fx, signupId)).toEqual([3, 3, 3, 3]);
    // The slot that already had 3 did not change, so there is nothing to put back.
    expect(set.value.previous).toEqual([
      { id: ids[0], capacity: 1 },
      { id: ids[1], capacity: null },
      { id: ids[3], capacity: 8 },
    ]);

    const back = await updateSlotCapacities(fx.db, fx.actor, signupId, {
      slots: set.value.previous,
    });
    expect(back.ok, JSON.stringify(back)).toBe(true);
    expect(await capacitiesOf(fx, signupId)).toEqual(original);
    expect(await slotUpdates(fx, signupId)).toHaveLength(2);
  });

  it('two calls at once on the same slots both apply, one after the other', async () => {
    const { signupId, ids } = await makeSignup(fx, 'Capacities race', [1, 1, 1]);
    const twos = ids.map((id) => ({ id, capacity: 2 }));
    const climbing = ids.map((id, i) => ({ id, capacity: 5 + i }));
    const [first, second] = await Promise.all([
      updateSlotCapacities(fx.db, fx.actor, signupId, { slots: twos }),
      updateSlotCapacities(fx.db, fx.actor, signupId, { slots: climbing }),
    ]);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    if (!first.ok || !second.ok) return;

    const final = await capacitiesOf(fx, signupId);
    expect([
      [2, 2, 2],
      [5, 6, 7],
    ]).toContainEqual(final);
    // Whichever ran second found what the first had written.
    const [earlier, later] = final[0] === 2 ? [second, first] : [first, second];
    expect(earlier.value.previous.map((p) => p.capacity)).toEqual([1, 1, 1]);
    expect(later.value.previous.map((p) => p.capacity)).toEqual(
      final[0] === 2 ? [5, 6, 7] : [2, 2, 2],
    );
    expect(await slotUpdates(fx, signupId)).toHaveLength(2);
  });
});
