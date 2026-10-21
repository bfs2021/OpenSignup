import { z } from 'zod';
import { SortOrderSchema } from './common';
import { FIELD_TYPES, LABEL_MAX_LENGTH, RefSchema, SlotFieldConfigSchema } from './slot-fields';
import { MAX_CAPACITY, MAX_MERGE_SLOTS, SLOTS_PER_BULK_ADD, SlotUnmergeInputSchema } from './slots';

const IdSchema = z.string().min(1).max(64);

/**
 * A fix the review page asks for: the notice's kind and the ids it named, so
 * the server can find the same notice again on fresh data. A field's new name
 * is checked by the service, which says what was wrong with it.
 */
export const DraftFixRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty_field'), fieldId: IdSchema }).strict(),
  z
    .object({
      kind: z.literal('blank_slot'),
      slotIds: z.array(IdSchema).min(1).max(SLOTS_PER_BULK_ADD),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unnamed_field'),
      fieldId: IdSchema,
      label: z.string().max(LABEL_MAX_LENGTH * 2),
    })
    .strict(),
  z.object({ kind: z.literal('ungrouped_dates'), fieldId: IdSchema }).strict(),
  z
    .object({
      kind: z.literal('duplicate_slots'),
      slotIds: z.array(IdSchema).min(2).max(MAX_MERGE_SLOTS),
    })
    .strict(),
]);
export type DraftFixRequest = z.infer<typeof DraftFixRequestSchema>;

/**
 * The kinds of draft notice the review page fixes in one tap (issue #503):
 * those the request takes. Every other kind links to the builder.
 */
export type DraftFixKind = DraftFixRequest['kind'];

/**
 * The review page's Remove day (issue #504): every slot of one group of its
 * slot list, on a page grouped by a date field. `value` is the group's value
 * of that field (its key in `groupSlots`), and `fingerprint` stands for the
 * slots the page showed in it (`slotSetFingerprint`), so the server can find
 * the same day, with the same slots, again on fresh data without the page
 * holding every slot's id.
 */
export const RemoveDayRequestSchema = z
  .object({
    kind: z.literal('remove_day'),
    ref: RefSchema,
    value: z.string().min(1).max(2000),
    fingerprint: z.string().min(1).max(64),
  })
  .strict();
export type RemoveDayRequest = z.infer<typeof RemoveDayRequestSchema>;

/** How many people "People for each slot" gives each slot: a whole number, 1 or more. */
const PeopleEachSchema = z.number().int().positive().max(MAX_CAPACITY);

/**
 * The review page's "People for each slot" (issue #504): every slot of the
 * draft to take `capacity` people. `fingerprint` stands for every slot the
 * page showed (`slotSetFingerprint`), as for Remove day, so the server sets
 * only the slots the organizer saw, without the page holding every id.
 */
export const SetCapacityRequestSchema = z
  .object({
    kind: z.literal('set_capacity'),
    capacity: PeopleEachSchema,
    fingerprint: z.string().min(1).max(64),
  })
  .strict();
export type SetCapacityRequest = z.infer<typeof SetCapacityRequestSchema>;

/** Slots taken out, as they were, for an undo to add back. */
const RemovedSlotsSchema = z
  .array(
    z
      .object({
        values: z.record(z.string(), z.unknown()),
        capacity: z.number().int().positive().nullable(),
        sortOrder: SortOrderSchema,
        closed: z.boolean(),
      })
      .strict(),
  )
  .min(1)
  .max(SLOTS_PER_BULK_ADD);

/**
 * What it takes to undo a fix, by putting back what the fix changed through
 * the same services. The page holds it until the next fix and sends it back
 * for Undo; the server checks it against the signup before it acts on it.
 */
export const DraftFixUndoSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('empty_field'),
      field: z
        .object({
          ref: z.string().min(1).max(64),
          label: z.string().max(LABEL_MAX_LENGTH),
          fieldType: z.enum(FIELD_TYPES),
          config: SlotFieldConfigSchema,
        })
        .strict(),
      /** The field that came after it, to put it back in front of; null when it was last. */
      beforeFieldId: IdSchema.nullable(),
      /** The settings that named it, as they were. Empty when none did. */
      settings: z
        .object({
          reminderFromFieldRef: z.string().min(1).max(64).optional(),
          /**
           * With `reminderFromFieldRef`: the anchor deleting the field left
           * (null for none). Undo puts the old one back only while it's still
           * this, so a reminder date chosen since isn't overwritten.
           */
          anchorAfter: z.string().min(1).max(64).nullable().optional(),
          groupByFieldRefs: z.array(z.string().max(64)).max(1).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ kind: z.literal('blank_slot'), slots: RemovedSlotsSchema }).strict(),
  z
    .object({
      kind: z.literal('unnamed_field'),
      fieldId: IdSchema,
      /** The name the fix gave it. */
      label: z.string().max(LABEL_MAX_LENGTH),
      /** The name it had before. */
      previous: z.string().max(LABEL_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ungrouped_dates'),
      /** The field the fix grouped the page by. */
      ref: z.string().min(1).max(64),
      /** The grouping before, as stored. */
      previous: z.array(z.string().max(64)).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('duplicate_slots'),
      /** What `mergeSlots` returned, for `unmergeSlots`, as it is. */
      unmerge: SlotUnmergeInputSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('remove_day'),
      /** The date field and the day, as the request named them. */
      ref: RefSchema,
      value: z.string().min(1).max(2000),
      slots: RemovedSlotsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set_capacity'),
      /** What "People for each slot" set every slot to. */
      capacity: PeopleEachSchema,
      /** Each slot it changed, with the capacity it had before; null for no limit. */
      previous: z
        .array(
          z.object({ id: IdSchema, capacity: z.number().int().positive().nullable() }).strict(),
        )
        .min(1)
        .max(SLOTS_PER_BULK_ADD),
    })
    .strict(),
]);
export type DraftFixUndo = z.infer<typeof DraftFixUndoSchema>;

/** What an undo puts back: a one-tap fix's kind, `remove_day` or `set_capacity`. */
export type DraftUndoKind = DraftFixUndo['kind'];
