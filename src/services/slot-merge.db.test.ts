import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { activity } from '@/db/schema/activity';
import { commitments } from '@/db/schema/commitments';
import { workspaceMembers } from '@/db/schema/members';
import { organizers } from '@/db/schema/organizers';
import { signups } from '@/db/schema/signups';
import { workspaces } from '@/db/schema/workspaces';
import { makeId } from '@/lib/ids';
import type { Actor } from '@/lib/policy';
import { commitToSlot } from '@/services/commitments';
import { createSignup, deleteSignup, publishSignup } from '@/services/signups';
import { deleteField, listFieldsForSignup } from '@/services/slot-fields';
import { mergeSlots, unmergeSlots } from '@/services/slot-merge';
import { deleteSlot, listSlotsForSignup, reorderSlots, updateSlot } from '@/services/slots';
import { settle, untilServiceBlockedOn } from '@/services/testing/locks';

interface Fixture {
  db: Db;
  workspaceId: string;
  organizerId: string;
  actor: Extract<Actor, { kind: 'organizer' }>;
  /** A second editor, for a service held open while the first one's queues behind it. */
  colleague: Extract<Actor, { kind: 'organizer' }>;
}

async function addOrganizer(db: Db, workspaceId: string, role: 'owner' | 'editor') {
  const id = makeId('org');
  const email = `merge-${id.slice(-8).toLowerCase()}@example.test`;
  await db.insert(organizers).values({ id, email, name: 'Test Org' });
  await db.insert(workspaceMembers).values({
    id: makeId('mem'),
    workspaceId,
    organizerId: id,
    role,
    status: 'active',
  });
  const actor: Extract<Actor, { kind: 'organizer' }> = {
    kind: 'organizer',
    id,
    email,
    workspaceIds: [workspaceId],
    workspaceRoles: { [workspaceId]: role },
  };
  return actor;
}

async function setupWorkspace(): Promise<Fixture> {
  const db = getDb();
  const workspaceId = makeId('ws');
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `test-${workspaceId.slice(-8).toLowerCase()}`,
    name: 'Test Workspace',
    type: 'personal',
    plan: 'free',
  });
  const actor = await addOrganizer(db, workspaceId, 'owner');
  const colleague = await addOrganizer(db, workspaceId, 'editor');
  return { db, workspaceId, organizerId: actor.id, actor, colleague };
}

async function teardownWorkspace(fx: Fixture): Promise<void> {
  await fx.db.delete(workspaces).where(eq(workspaces.id, fx.workspaceId));
  await fx.db.delete(organizers).where(eq(organizers.id, fx.actor.id));
  await fx.db.delete(organizers).where(eq(organizers.id, fx.colleague.id));
}

interface Row {
  role: string;
  day?: string;
  capacity: number | null;
}

/**
 * A draft with a `role` text field and a `day` date field (the reminder
 * anchor), and one slot per row, numbered 0..n-1 in the order given.
 */
async function makeDraft(fx: Fixture, title: string, rows: Row[]) {
  const created = await createSignup(
    fx.db,
    fx.actor,
    fx.workspaceId,
    { title },
    {
      template: {
        id: 'merge-test',
        fields: [
          {
            ref: 'role',
            label: 'Role',
            fieldType: 'text',
            sortOrder: 0,
            config: { fieldType: 'text', maxLength: 200 },
          },
          {
            ref: 'day',
            label: 'Day',
            fieldType: 'date',
            sortOrder: 1,
            config: { fieldType: 'date' },
          },
        ],
        slots: rows.map(({ role, day, capacity }, sortOrder) => ({
          values: { role, ...(day !== undefined ? { day } : {}) },
          capacity,
          sortOrder,
        })),
      },
    },
  );
  if (!created.ok) throw new Error(`createSignup failed: ${created.error.message}`);
  const signupId = created.value.id;
  expect(created.value.settings).toMatchObject({ reminderFromFieldRef: 'day' });
  // In the order shown, which is the order the rows were given.
  const ids = (await listSlotsForSignup(fx.db, signupId)).map((s) => s.id);
  return { signupId, ids };
}

/** The slots as participants see them, in order, without ids or timestamps. */
async function shown(fx: Fixture, signupId: string) {
  const rows = await listSlotsForSignup(fx.db, signupId);
  return rows.map((r) => ({
    values: r.values,
    capacity: r.capacity,
    sortOrder: r.sortOrder,
    status: r.status,
    slotAt: r.slotAt?.toISOString() ?? null,
  }));
}

async function events(fx: Fixture, signupId: string, eventType: 'slot.merged' | 'slot.unmerged') {
  return fx.db
    .select()
    .from(activity)
    .where(and(eq(activity.signupId, signupId), eq(activity.eventType, eventType)));
}

const helpers: Row[] = [
  { role: 'Setup', day: '2026-05-10', capacity: 1 },
  { role: 'Helper', day: '2026-05-10', capacity: 2 },
  { role: 'Cleanup', day: '2026-05-10', capacity: 1 },
  { role: 'Helper', day: '2026-05-10', capacity: 3 },
  { role: 'Helper', day: '2026-05-10', capacity: 1 },
];

describe('mergeSlots (db)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await setupWorkspace();
  });
  afterAll(async () => {
    await teardownWorkspace(fx);
  });

  it('gives the kept slot the total capacity, deletes the rest, and records one slot.merged row', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge happy path', helpers);
    const [setup, h1, cleanup, h2, h3] = ids as [string, string, string, string, string];

    const r = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: h1,
      // In any order: the kept slot is named, and the rest go.
      slotIds: [h3, h1, h2],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.slot).toMatchObject({ id: h1, capacity: 6, values: { role: 'Helper' } });

    const after = await listSlotsForSignup(fx.db, signupId);
    expect(after.map((s) => s.id)).toEqual([setup, h1, cleanup]);
    expect(after.map((s) => s.capacity)).toEqual([1, 6, 1]);

    // What undoing it takes: the kept slot as it was, and the others in the
    // order they were shown.
    expect(r.value.undo).toEqual({
      keepSlotId: h1,
      // The version an undo checks the kept slot against.
      keptUpdatedAt: r.value.slot.updatedAt.toISOString(),
      previous: { values: { role: 'Helper', day: '2026-05-10' }, capacity: 2 },
      restored: [
        { values: { role: 'Helper', day: '2026-05-10' }, capacity: 3, sortOrder: 3 },
        { values: { role: 'Helper', day: '2026-05-10' }, capacity: 1, sortOrder: 4 },
      ],
    });

    const merged = await events(fx, signupId, 'slot.merged');
    expect(merged).toHaveLength(1);
    expect(merged[0]!.payload).toEqual({ slotId: h1, mergedSlotIds: [h2, h3], capacity: 6 });
    expect(merged[0]!).toMatchObject({ actorId: fx.organizerId, actorType: 'organizer' });
  });

  it('takes the capacity from the rows, not the caller, and has no limit when any copy has none', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge unlimited', [
      { role: 'Helper', capacity: 2 },
      { role: 'Helper', capacity: null },
    ]);
    // A capacity sent is not part of the input at all.
    const sent = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: ids[0],
      slotIds: ids,
      capacity: 5,
    });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error.code).toBe('invalid_input');

    const r = await mergeSlots(fx.db, fx.actor, signupId, { keepSlotId: ids[0], slotIds: ids });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.value.slot.capacity).toBeNull();
    expect(await shown(fx, signupId)).toEqual([
      { values: { role: 'Helper' }, capacity: null, sortOrder: 0, status: 'open', slotAt: null },
    ]);
    const merged = await events(fx, signupId, 'slot.merged');
    expect(merged[0]?.payload).toMatchObject({ capacity: null });
  });

  it('writes the values numbered rows share, without the number', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge numbered', [
      { role: 'Helper 1', day: '2026-05-10', capacity: 1 },
      { role: 'Helper 2', day: '2026-05-10', capacity: 1 },
    ]);
    const r = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: ids[0],
      slotIds: ids,
      values: { day: '2026-05-10', role: 'Helper' },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await shown(fx, signupId)).toEqual([
      {
        values: { day: '2026-05-10', role: 'Helper' },
        capacity: 2,
        sortOrder: 0,
        status: 'open',
        slotAt: '2026-05-10T12:00:00.000Z',
      },
    ]);
  });

  it('leaves the values and slot_at alone when none are sent', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge keep values', [
      { role: 'Helper', day: '2026-05-10', capacity: 1 },
      { role: 'Helper', day: '2026-05-10', capacity: 1 },
    ]);
    const r = await mergeSlots(fx.db, fx.actor, signupId, { keepSlotId: ids[1], slotIds: ids });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const after = await listSlotsForSignup(fx.db, signupId);
    expect(after.map((s) => s.id)).toEqual([ids[1]]);
    expect(after[0]).toMatchObject({ values: { role: 'Helper', day: '2026-05-10' }, capacity: 2 });
    expect(after[0]?.slotAt?.toISOString()).toBe('2026-05-10T12:00:00.000Z');
  });

  it('refuses values other than the ones the copies share, and changes nothing', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge other values', [
      { role: 'Helper 1', day: '2026-05-10', capacity: 1 },
      { role: 'Helper 2', day: '2026-05-10', capacity: 1 },
    ]);
    const before = await shown(fx, signupId);
    for (const values of [
      { role: 'Helper', day: '2026-05-11' },
      { role: 'Helper 1', day: '2026-05-10' },
      { shift: 'Morning' },
      { day: 'next Tuesday' },
    ]) {
      const r = await mergeSlots(fx.db, fx.actor, signupId, {
        keepSlotId: ids[0],
        slotIds: ids,
        values,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatchObject({
          code: 'conflict',
          field: 'values',
          details: { expected: { role: 'Helper', day: '2026-05-10' } },
        });
      }
    }
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.merged')).toHaveLength(0);
  });

  it('refuses slots that are not every copy, or not copies, and deletes nothing', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge not copies', helpers);
    for (const slotIds of [
      [ids[1]!, ids[3]!],
      [ids[0]!, ids[2]!],
      [ids[0]!, ids[1]!, ids[3]!, ids[4]!],
    ]) {
      const r = await mergeSlots(fx.db, fx.actor, signupId, { keepSlotId: slotIds[0], slotIds });
      expect(r.ok, JSON.stringify(slotIds)).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatchObject({
          code: 'conflict',
          field: 'slotIds',
          details: { reason: 'not_copies' },
        });
      }
    }
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length);
    expect(await events(fx, signupId, 'slot.merged')).toHaveLength(0);
  });

  it('refuses copies one of which was changed after the page found them', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge renamed', helpers);
    const renamed = await updateSlot(fx.db, fx.actor, ids[4]!, {
      values: { role: 'Helper', day: '2026-05-11' },
    });
    expect(renamed.ok, JSON.stringify(renamed)).toBe(true);
    const before = await shown(fx, signupId);

    const r = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: ids[1],
      slotIds: [ids[1], ids[3], ids[4]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', field: 'slotIds' });
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.merged')).toHaveLength(0);
  });

  it('refuses a published signup, and changes nothing', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge published', helpers);
    const pub = await publishSignup(fx.db, fx.actor, signupId);
    expect(pub.ok, JSON.stringify(pub)).toBe(true);
    const before = await shown(fx, signupId);

    const r = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: ids[1],
      slotIds: [ids[1], ids[3], ids[4]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ code: 'conflict', field: 'status', received: 'open' });
    }
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.merged')).toHaveLength(0);
  });

  it('refuses a slot of another signup, naming it, and changes neither', async () => {
    const mine = await makeDraft(fx, 'Merge mine', helpers.slice(0, 2));
    const theirs = await makeDraft(fx, 'Merge theirs', helpers.slice(0, 2));
    const foreign = theirs.ids[1]!;
    const before = [await shown(fx, mine.signupId), await shown(fx, theirs.signupId)];

    const r = await mergeSlots(fx.db, fx.actor, mine.signupId, {
      keepSlotId: mine.ids[1],
      slotIds: [mine.ids[1], foreign],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({
        code: 'invalid_input',
        field: 'slotIds',
        received: foreign,
        details: { unknown: [foreign] },
      });
      expect(r.error.message).toContain(foreign);
    }
    expect([await shown(fx, mine.signupId), await shown(fx, theirs.signupId)]).toEqual(before);
  });

  it('refuses a viewer', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge viewer', helpers);
    // requireWorkspaceWrite reads actor.workspaceRoles, so no member row is needed.
    const viewer: Actor = {
      ...fx.actor,
      id: makeId('org'),
      workspaceRoles: { [fx.workspaceId]: 'viewer' },
    };
    await expect(
      mergeSlots(fx.db, viewer, signupId, { keepSlotId: ids[1], slotIds: [ids[1], ids[3]] }),
    ).rejects.toMatchObject({ serviceError: { code: 'forbidden' } });
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length);
  });

  it('refuses fewer than two slots, one named twice, and a kept slot not among them', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge bad input', helpers);
    const [, h1, , h2] = ids as [string, string, string, string];
    const cases: [unknown, string][] = [
      [{ keepSlotId: h1, slotIds: [h1] }, 'slotIds'],
      [{ keepSlotId: h1, slotIds: [h1, h1] }, 'slotIds.1'],
      [{ keepSlotId: ids[0], slotIds: [h1, h2] }, 'keepSlotId'],
      [{ slotIds: [h1, h2] }, 'keepSlotId'],
    ];
    for (const [input, field] of cases) {
      const r = await mergeSlots(fx.db, fx.actor, signupId, input);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: 'invalid_input', field });
    }
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length);
    expect(await events(fx, signupId, 'slot.merged')).toHaveLength(0);
  });

  it('refuses a closed slot', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge closed', helpers);
    const closed = await updateSlot(fx.db, fx.actor, ids[3]!, { status: 'closed' });
    expect(closed.ok, JSON.stringify(closed)).toBe(true);
    const r = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: ids[1],
      slotIds: [ids[1], ids[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', received: ids[3] });
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length);
  });

  it('refuses slots someone has signed up for rather than deleting their place', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge booked', helpers);
    expect((await publishSignup(fx.db, fx.actor, signupId)).ok).toBe(true);
    const committed = await commitToSlot(fx.db, ids[3]!, {
      name: 'Pat Example',
      email: 'pat@example.com',
    });
    expect(committed.ok, JSON.stringify(committed)).toBe(true);
    // No service puts a signup back to draft; this is the case that cannot
    // happen today, made by hand.
    await fx.db.update(signups).set({ status: 'draft' }).where(eq(signups.id, signupId));

    const r = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: ids[1],
      slotIds: [ids[1], ids[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', details: { commitments: 1 } });
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length);
    const kept = await fx.db.select().from(commitments).where(eq(commitments.slotId, ids[3]!));
    expect(kept).toHaveLength(1);
  });

  it('refuses a deleted signup as not found', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge deleted', helpers);
    expect((await deleteSignup(fx.db, fx.actor, signupId)).ok).toBe(true);
    const r = await mergeSlots(fx.db, fx.actor, signupId, {
      keepSlotId: ids[1],
      slotIds: [ids[1], ids[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });

  it('a merge queued behind a publish is refused, and deletes nothing', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge during publish', helpers);
    let merging: ReturnType<typeof mergeSlots> | undefined;
    const held = fx.db.transaction(async (tx) => {
      const pub = await publishSignup(tx as unknown as Db, fx.colleague, signupId);
      expect(pub.ok, JSON.stringify(pub)).toBe(true);
      // Still sees a draft, since the publish has not committed.
      merging = mergeSlots(fx.db, fx.actor, signupId, {
        keepSlotId: ids[1],
        slotIds: [ids[1], ids[3]],
      });
      await untilServiceBlockedOn(fx.db, tx, merging);
    });
    await held.finally(() => settle(merging));
    const r = await merging!;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', field: 'status' });
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length);
  });

  it('the same merge sent twice at once merges once, and the second is refused', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge double tap', helpers);
    const input = { keepSlotId: ids[1], slotIds: [ids[1], ids[3], ids[4]] };
    const results = await Promise.all([
      mergeSlots(fx.db, fx.actor, signupId, input),
      mergeSlots(fx.db, fx.actor, signupId, input),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused && !refused.ok && refused.error).toMatchObject({
      code: 'invalid_input',
      field: 'slotIds',
      details: { unknown: [ids[3], ids[4]] },
    });
    const after = await listSlotsForSignup(fx.db, signupId);
    expect(after.map((s) => s.capacity)).toEqual([1, 6, 1]);
    expect(await events(fx, signupId, 'slot.merged')).toHaveLength(1);
  });

  it('two merges of the same copies at once, keeping different slots, merge once', async () => {
    const { signupId, ids } = await makeDraft(fx, 'Merge overlap', [
      { role: 'Helper', capacity: 1 },
      { role: 'Helper', capacity: 2 },
      { role: 'Helper', capacity: 4 },
    ]);
    const [a, b, c] = ids as [string, string, string];
    const results = await Promise.all([
      mergeSlots(fx.db, fx.actor, signupId, { keepSlotId: a, slotIds: [a, b, c] }),
      mergeSlots(fx.db, fx.actor, signupId, { keepSlotId: b, slotIds: [a, b, c] }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const after = await listSlotsForSignup(fx.db, signupId);
    expect(after).toHaveLength(1);
    expect(after[0]?.capacity).toBe(7);
    expect(await events(fx, signupId, 'slot.merged')).toHaveLength(1);
  });
});

describe('unmergeSlots (db)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await setupWorkspace();
  });
  afterAll(async () => {
    await teardownWorkspace(fx);
  });

  async function merged(title: string, rows: Row[], keep: number, take: number[], values?: object) {
    const draft = await makeDraft(fx, title, rows);
    const before = await shown(fx, draft.signupId);
    const r = await mergeSlots(fx.db, fx.actor, draft.signupId, {
      keepSlotId: draft.ids[keep],
      slotIds: take.map((i) => draft.ids[i]),
      ...(values ? { values } : {}),
    });
    if (!r.ok) throw new Error(`mergeSlots failed: ${r.error.message}`);
    return { ...draft, before, merge: r.value };
  }

  it('puts back every slot the merge took, in the order they were shown, and records one row', async () => {
    const { signupId, ids, before, merge } = await merged('Unmerge', helpers, 1, [1, 3, 4]);
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(3);

    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.value.slot).toMatchObject({ id: ids[1], capacity: 2 });
    expect(r.value.restored).toHaveLength(2);

    expect(await shown(fx, signupId)).toEqual(before);
    const after = await listSlotsForSignup(fx.db, signupId);
    // The kept slot is the same row; the others are new ones in the old places.
    expect(after.map((s) => s.id)).toEqual([
      ids[0],
      ids[1],
      ids[2],
      r.value.restored[0]!.id,
      r.value.restored[1]!.id,
    ]);

    const rows = await events(fx, signupId, 'slot.unmerged');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({
      slotId: ids[1],
      restoredSlotIds: r.value.restored.map((s) => s.id),
      capacity: 2,
    });
    expect(rows[0]!).toMatchObject({ actorId: fx.organizerId, actorType: 'organizer' });
  });

  it('puts back the values a merge replaced, and their slot_at', async () => {
    const { signupId, before, merge } = await merged(
      'Unmerge numbered',
      [
        { role: 'Helper 1', day: '2026-05-10', capacity: 1 },
        { role: 'Setup', day: '2026-05-09', capacity: null },
        { role: 'Helper 2', day: '2026-05-10', capacity: 1 },
      ],
      0,
      [0, 2],
      { role: 'Helper', day: '2026-05-10' },
    );
    expect(await shown(fx, signupId)).not.toEqual(before);
    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await shown(fx, signupId)).toEqual(before);
  });

  it('undoes a merge with no limit', async () => {
    const { signupId, before, merge } = await merged(
      'Unmerge unlimited',
      [
        { role: 'Helper', capacity: 3 },
        { role: 'Helper', capacity: null },
      ],
      0,
      [0, 1],
    );
    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await shown(fx, signupId)).toEqual(before);
  });

  it("refuses when the merged slot's capacity has changed since, and changes nothing", async () => {
    const { signupId, ids, merge } = await merged('Unmerge changed', helpers, 1, [1, 3, 4]);
    const edit = await updateSlot(fx.db, fx.actor, ids[1]!, { capacity: 10 });
    expect(edit.ok, JSON.stringify(edit)).toBe(true);
    const before = await shown(fx, signupId);

    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({
        code: 'conflict',
        field: 'keepSlotId',
        expected: merge.undo.keptUpdatedAt,
      });
    }
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.unmerged')).toHaveLength(0);
  });

  it('refuses when the merged slot has been deleted since', async () => {
    const { signupId, ids, merge } = await merged('Unmerge gone', helpers, 1, [1, 3, 4]);
    expect((await deleteSlot(fx.db, fx.actor, ids[1]!)).ok).toBe(true);
    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', field: 'keepSlotId' });
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length - 3);
  });

  it('refuses once the signup is published', async () => {
    const { signupId, merge } = await merged('Unmerge published', helpers, 1, [1, 3, 4]);
    expect((await publishSignup(fx.db, fx.actor, signupId)).ok).toBe(true);
    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', field: 'status' });
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length - 2);
  });

  it('refuses a value for a field deleted since, and changes nothing', async () => {
    const { signupId, merge } = await merged('Unmerge field gone', helpers, 1, [1, 3, 4]);
    const fields = await listFieldsForSignup(fx.db, signupId);
    const day = fields.find((f) => f.ref === 'day')!;
    expect((await deleteField(fx.db, fx.actor, day.id)).ok).toBe(true);
    const before = await shown(fx, signupId);

    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'invalid_input', field: 'day' });
    expect(await shown(fx, signupId)).toEqual(before);
  });

  it('refuses a viewer', async () => {
    const { signupId, merge } = await merged('Unmerge viewer', helpers, 1, [1, 3, 4]);
    const viewer: Actor = {
      ...fx.actor,
      id: makeId('org'),
      workspaceRoles: { [fx.workspaceId]: 'viewer' },
    };
    await expect(unmergeSlots(fx.db, viewer, signupId, merge.undo)).rejects.toMatchObject({
      serviceError: { code: 'forbidden' },
    });
    expect(await listSlotsForSignup(fx.db, signupId)).toHaveLength(helpers.length - 2);
  });

  it('the same undo sent twice at once puts the slots back once', async () => {
    const { signupId, before, merge } = await merged('Unmerge double tap', helpers, 1, [1, 3, 4]);
    const results = await Promise.all([
      unmergeSlots(fx.db, fx.actor, signupId, merge.undo),
      unmergeSlots(fx.db, fx.actor, signupId, merge.undo),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused && !refused.ok && refused.error).toMatchObject({
      code: 'conflict',
      field: 'keepSlotId',
    });
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.unmerged')).toHaveLength(1);
  });

  it('refuses once the merged slot’s values have changed, its places untouched', async () => {
    const { signupId, ids, merge } = await merged('Unmerge renamed', helpers, 1, [1, 3, 4]);
    const edit = await updateSlot(fx.db, fx.actor, ids[1]!, {
      values: { role: 'Helpers', day: '2026-05-11' },
    });
    expect(edit.ok, JSON.stringify(edit)).toBe(true);
    const before = await shown(fx, signupId);
    expect(before.find((s) => s.sortOrder === 1)).toMatchObject({ capacity: 6 });

    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', field: 'keepSlotId' });
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.unmerged')).toHaveLength(0);
  });

  it('refuses once the merged slot has been moved', async () => {
    const { signupId, ids, merge } = await merged('Unmerge moved', helpers, 1, [1, 3, 4]);
    const [setup, h1, cleanup] = ids as [string, string, string];
    const moved = await reorderSlots(fx.db, fx.actor, signupId, { slotIds: [h1, setup, cleanup] });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    const before = await shown(fx, signupId);

    const r = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'conflict', field: 'keepSlotId' });
    expect(await shown(fx, signupId)).toEqual(before);
  });

  // With no limit, the kept slot reads the same before the merge and after its
  // undo, so only its version (`updatedAt`) tells a second undo from the first.
  const unlimited: Row[] = [
    { role: 'Helper', capacity: null },
    { role: 'Helper', capacity: null },
    { role: 'Helper', capacity: null },
  ];

  it('refuses an undo of copies with no limit that was undone already', async () => {
    const { signupId, before, merge } = await merged('Unmerge twice', unlimited, 0, [0, 1, 2]);
    const first = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const second = await unmergeSlots(fx.db, fx.actor, signupId, merge.undo);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatchObject({ code: 'conflict', field: 'keepSlotId' });
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.unmerged')).toHaveLength(1);
  });

  it('puts copies with no limit back once when the same undo is sent twice at once', async () => {
    const { signupId, before, merge } = await merged('Unmerge tap tap', unlimited, 0, [0, 1, 2]);
    const results = await Promise.all([
      unmergeSlots(fx.db, fx.actor, signupId, merge.undo),
      unmergeSlots(fx.db, fx.actor, signupId, merge.undo),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await shown(fx, signupId)).toEqual(before);
    expect(await events(fx, signupId, 'slot.unmerged')).toHaveLength(1);
  });

  it('undoes a merge made again after an undo', async () => {
    const { signupId, ids, before, merge } = await merged('Merge again', unlimited, 0, [0, 1, 2]);
    expect((await unmergeSlots(fx.db, fx.actor, signupId, merge.undo)).ok).toBe(true);
    const slotIds = (await listSlotsForSignup(fx.db, signupId)).map((s) => s.id);
    const again = await mergeSlots(fx.db, fx.actor, signupId, { keepSlotId: ids[0]!, slotIds });
    expect(again.ok, JSON.stringify(again)).toBe(true);
    if (!again.ok) return;
    const r = await unmergeSlots(fx.db, fx.actor, signupId, again.value.undo);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await shown(fx, signupId)).toEqual(before);
  });
});
