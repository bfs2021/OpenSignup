import { placeholderIn } from '@/lib/placeholder-text';
import type { SignupStatus } from '@/schemas/signups';

/**
 * The tag on a slot row whose values still hold TBD, TBC or TBA, by the test
 * Publish's check uses, naming the first one in the fields' order: "Still
 * says “TBD”" on a draft; "People can see “TBD”" once people can open the
 * page, while it's open or closed (an archived signup shows them none of it).
 * Null when the slot holds none.
 */
export function placeholderMark(
  values: Record<string, unknown>,
  fields: readonly { ref: string }[],
  status: SignupStatus,
): string | null {
  for (const { ref } of fields) {
    const word = placeholderIn(values[ref]);
    if (word) {
      return status === 'open' || status === 'closed'
        ? `People can see “${word}”`
        : `Still says “${word}”`;
    }
  }
  return null;
}

type SlotNameParts = {
  anchor: string;
  time: boolean;
  prompt: string | null;
};

/**
 * How the Build tab names a slot, which stands in for what its row shows: its
 * first field's value ("slot at 9:00 AM" for a time, "slot — Surfing"
 * otherwise) or, when that's empty, the prompt it shows instead ("slot — Set a
 * date"). The row, its toolbar's buttons and its open editor all start from
 * it, so each says which slot it's for.
 */
function slotName({ anchor, time, prompt }: SlotNameParts): string {
  return anchor
    ? time
      ? `slot at ${anchor}`
      : `slot — ${anchor}`
    : prompt
      ? `slot — ${prompt}`
      : 'slot';
}

/** The names of a collapsed row's toolbar buttons and of its open editor. */
export function slotActionLabels(parts: SlotNameParts): {
  edit: string;
  duplicate: string;
  delete: string;
  editing: string;
} {
  const name = slotName(parts);
  return {
    edit: `Edit ${name}`,
    duplicate: `Duplicate ${name}`,
    delete: `Delete ${name}`,
    editing: `Editing ${name}`,
  };
}

/**
 * A collapsed slot row's accessible name: "Edit" and the slot's name, then
 * what else the row shows, in its order: its tag, if it has one ("still says
 * “TBD”"), and the spots taken ("0 of 6 taken").
 */
export function slotRowLabel({
  mark,
  count,
  ...parts
}: SlotNameParts & { mark: string | null; count: string }): string {
  const tag = mark ? `, ${mark.charAt(0).toLowerCase()}${mark.slice(1)}` : '';
  return `Edit ${slotName(parts)}${tag}, ${count}`;
}

/** The spots a slot row says are taken: "2 of 6 taken", or "2 taken" with no limit. */
export function takenText(taken: number, capacity: number | null): string {
  return capacity === null ? `${taken} taken` : `${taken} of ${capacity} taken`;
}
