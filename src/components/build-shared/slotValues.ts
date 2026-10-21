/**
 * A slot's values as the slot editor holds them (every cell a string) and as
 * `PATCH /api/slots/[id]` takes them. The Build tab and the review page both
 * build their request bodies here, so the two can't send a slot differently.
 * No imports: the review page's script loads this.
 */

/** The part of a field these need: its ref, and its type to coerce by. */
type ValueField = { ref: string; config: { fieldType: string } };

/** Stored values as the editor's cells show them: null and missing are ''. */
export function toStringValues(values: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    result[k] = v === null || v === undefined ? '' : String(v);
  }
  return result;
}

/**
 * The editor's cells as the slot route takes them. A number field's value
 * goes as a number, and an empty or unreadable one is left out; every other
 * value goes as it was typed.
 */
export function toSlotValues(
  values: Record<string, string>,
  fields: readonly ValueField[],
): Record<string, unknown> {
  const typed: Record<string, unknown> = {};
  for (const [ref, text] of Object.entries(values)) {
    const field = fields.find((f) => f.ref === ref);
    if (field?.config.fieldType === 'number') {
      const n = Number(text);
      if (text !== '' && Number.isFinite(n)) typed[ref] = n;
    } else {
      typed[ref] = text;
    }
  }
  return typed;
}

/**
 * What an editor changed on one slot: the cells it set, by field ref, and
 * the capacity, when it set one (null is no limit).
 */
export type SlotDraft = { values: Record<string, string>; capacity?: number | null };

/**
 * The body of the one `PATCH /api/slots/[id]` that saves `draft` over the
 * slot as stored, or null when the draft changes nothing. The route replaces
 * a slot's values whole, so a changed value sends them all: the stored ones
 * with the draft's on top. Capacity goes only when it changed.
 */
export function slotPatch(
  stored: { values: Record<string, unknown>; capacity: number | null },
  draft: SlotDraft,
  fields: readonly ValueField[],
): { values?: Record<string, unknown>; capacity?: number | null } | null {
  const current = toStringValues(stored.values);
  const valuesChanged = Object.entries(draft.values).some(
    ([ref, text]) => (current[ref] ?? '') !== text,
  );
  const capacityChanged = draft.capacity !== undefined && draft.capacity !== stored.capacity;
  if (!valuesChanged && !capacityChanged) return null;
  return {
    ...(valuesChanged ? { values: toSlotValues({ ...current, ...draft.values }, fields) } : {}),
    ...(capacityChanged ? { capacity: draft.capacity ?? null } : {}),
  };
}
