import { z } from 'zod';
import { SortOrderSchema } from './common';

const SLOT_STATUSES = ['open', 'closed'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

const SlotValuesSchema = z.record(z.string(), z.unknown());

const baseSlotInput = z.object({
  values: SlotValuesSchema.default({}),
  capacity: z.number().int().positive().nullable().default(1),
  sortOrder: SortOrderSchema.optional(),
});

export const SlotCreateInputSchema = baseSlotInput;
export type SlotCreateInput = z.infer<typeof SlotCreateInputSchema>;

/** The most slots one bulk add takes. */
export const SLOTS_PER_BULK_ADD = 500;

export const SlotBulkInputSchema = z.object({
  rows: z
    .array(
      z.object({
        values: SlotValuesSchema.default({}),
        capacity: z.number().int().positive().nullable().optional(),
        sortOrder: SortOrderSchema.optional(),
      }),
    )
    .min(1)
    .max(SLOTS_PER_BULK_ADD),
  // Put the rows in front of this slot instead of at the end. Not allowed
  // together with a row `sortOrder`; `addSlotsBulk` checks that, because a
  // refinement here would hide `.shape` from the MCP tool that builds on it.
  beforeSlotId: z.string().optional(),
});

// Every slot id of the signup, in the order they should be shown. No maximum:
// nothing caps slots per signup, so any ceiling here would make a signup above
// it impossible to reorder. The MCP route's body cap is what bounds a request.
export const SlotReorderInputSchema = z.object({
  slotIds: z.array(z.string()).min(1),
});

export const SlotUpdateInputSchema = z
  .object({
    values: SlotValuesSchema.optional(),
    capacity: z.number().int().positive().nullable().optional(),
    sortOrder: SortOrderSchema.optional(),
    status: z.enum(SLOT_STATUSES).optional(),
  })
  .strict();
export type SlotUpdateInput = z.infer<typeof SlotUpdateInputSchema>;

/** The most slots one merge takes in: as many as one bulk add makes. */
export const MAX_MERGE_SLOTS = 500;

const CapacitySchema = z.number().int().positive().nullable();

/**
 * Merge copies of a slot into one (issue #503): `keepSlotId` stays and takes
 * the copies' total capacity, and every other slot in `slotIds` is deleted.
 * `values`, when sent, replaces the kept slot's values, for numbered rows
 * ("Helper 1", "Helper 2") that become one "Helper" slot.
 */
export const SlotMergeInputSchema = z
  .object({
    keepSlotId: z.string().min(1),
    slotIds: z.array(z.string().min(1)).min(2).max(MAX_MERGE_SLOTS),
    values: SlotValuesSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [index, id] of input.slotIds.entries()) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slotIds', index],
          message: `slot ${id} is listed more than once`,
        });
      }
      seen.add(id);
    }
    if (!seen.has(input.keepSlotId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keepSlotId'],
        message: 'keepSlotId must be one of slotIds',
      });
    }
  });

/**
 * What undoes a merge, as `mergeSlots` returns it: the kept slot's values and
 * capacity before the merge, and the slots it deleted, in the order they were
 * shown.
 */
export const SlotUnmergeInputSchema = z.object({
  keepSlotId: z.string().min(1),
  previous: z.object({ values: SlotValuesSchema, capacity: CapacitySchema }),
  restored: z
    .array(
      z.object({
        values: SlotValuesSchema,
        capacity: CapacitySchema,
        sortOrder: SortOrderSchema,
        status: z.enum(SLOT_STATUSES).default('open'),
      }),
    )
    .min(1)
    .max(MAX_MERGE_SLOTS - 1),
});
export type SlotUnmergeInput = z.infer<typeof SlotUnmergeInputSchema>;
