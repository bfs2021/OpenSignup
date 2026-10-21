import type { SlotFieldDefinition } from '@/schemas/slot-fields';
import type { BuildField } from './useBuildState';

/**
 * Fields as the slot editor holds them, from the fields as the services
 * return them. Not a client module and no hooks, so the review page's server
 * component maps them here too, for the slot editor it opens.
 */
export function toBuildFields(fields: SlotFieldDefinition[]): BuildField[] {
  return fields.map((f) => ({
    id: f.id,
    ref: f.ref,
    name: f.label,
    config: f.config,
    sortOrder: f.sortOrder,
  }));
}
