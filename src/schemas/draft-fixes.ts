import { z } from 'zod';
import { SortOrderSchema } from './common';
import { FIELD_TYPES, LABEL_MAX_LENGTH, SlotFieldConfigSchema } from './slot-fields';
import { MAX_MERGE_SLOTS, SLOTS_PER_BULK_ADD, SlotUnmergeInputSchema } from './slots';

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
  z
    .object({
      kind: z.literal('blank_slot'),
      slots: z
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
        .max(SLOTS_PER_BULK_ADD),
    })
    .strict(),
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
]);
export type DraftFixUndo = z.infer<typeof DraftFixUndoSchema>;
