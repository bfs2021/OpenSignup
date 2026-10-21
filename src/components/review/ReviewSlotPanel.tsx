'use client';

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';
import { useRouter } from 'next/navigation';
import { slotPatch, toStringValues, type SlotDraft } from '@/components/build-shared/slotValues';
import type { BuildField } from '@/components/build-shared/useBuildState';
import { SlotEditor } from '@/components/build-wysiwyg/SlotEditor';
import { FormError } from '@/components/ui/form-error';
import { patchField, patchSlot } from './patch-signup';
import { useReviewSave } from './useReviewSave';

/** A slot as the server last sent it. */
export interface StoredSlot {
  id: string;
  values: Record<string, unknown>;
  capacity: number | null;
}

/** Saves the open slot, then opens `next`, or closes it when `next` is null. */
export type Finish = (next: string | null) => void;

const NO_CHANGES: SlotDraft = { values: {} };

/**
 * An open slot on the review page: the builder's `SlotEditor`, holding the
 * changes until Done, which sends them in one `PATCH /api/slots/[id]` (only
 * `values` if a value changed, only `capacity` if that did), then waits for
 * the page to come back from the server before it closes. Nothing changed,
 * Done just closes; Cancel or Escape closes without saving. A refusal keeps
 * it open and says why. The changes are laid over the slot as the server
 * last sent it, so the page's refresh after any save shows here too.
 *
 * Loaded only once a slot is opened (`ReviewSlotRow`), so none of this is in
 * the page's first load.
 */
export function ReviewSlotPanel({
  signupId,
  fields,
  stored,
  onClosed,
  finishRef,
}: {
  signupId: string;
  fields: BuildField[];
  stored: StoredSlot;
  /** It closed: whether it saved, and the slot to open next. */
  onClosed: (saved: boolean, next: string | null) => void;
  /** Where it puts its `finish`, for the slot list's buttons to call. */
  finishRef: MutableRefObject<Finish | null>;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [draft, setDraft] = useState<SlotDraft>(NO_CHANGES);
  const [adding, setAdding] = useState(false);
  // List choices added here, by field id. The ref is for the pick that lands
  // before this re-renders.
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const addedRef = useRef(added);
  const next = useRef<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const form = useReviewSave(
    (body) => patchSlot(stored.id, body),
    () => onClosed(true, next.current),
  );
  const busy = form.busy || adding;

  const finish: Finish = (then) => {
    if (busy) return;
    const body = slotPatch(stored, draft, fields);
    if (!body) {
      onClosed(false, then);
      return;
    }
    next.current = then;
    void form.save(body);
  };

  useEffect(() => {
    finishRef.current = finish;
    return () => {
      finishRef.current = null;
    };
  });

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, [aria-haspopup="listbox"]')?.focus();
  }, []);

  const cancel = () => {
    if (!busy) onClosed(false, null);
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // An open list picker, or the box for a new choice, closes on its own.
    if ((e.target as HTMLElement).closest('[aria-expanded="true"], [role="listbox"]')) return;
    e.preventDefault();
    cancel();
  }

  function editCell(fieldRef: string, value: string) {
    if (busy) return;
    const field = fields.find((f) => f.ref === fieldRef);
    // A list's value is one of its choices; one whose adding was refused isn't.
    if (
      field?.config.fieldType === 'enum' &&
      value !== '' &&
      !choicesOf(field, addedRef.current).includes(value)
    ) {
      return;
    }
    setDraft((d) => ({ ...d, values: { ...d.values, [fieldRef]: value } }));
  }

  /**
   * Adds a choice to a list field, saved straight away through the field
   * route the builder uses. The picker waits for this before it sets the
   * slot's value, which is saved with the slot on Done.
   */
  async function addOption(fieldId: string, value: string): Promise<void> {
    const field = fields.find((f) => f.id === fieldId);
    if (!field || field.config.fieldType !== 'enum') return;
    const choices = choicesOf(field, addedRef.current);
    if (choices.includes(value)) return;
    setAdding(true);
    const refused = await patchField(signupId, fieldId, {
      fieldType: 'enum',
      config: { fieldType: 'enum', choices: [...choices, value] },
    });
    setAdding(false);
    if (refused) {
      form.refuse(refused);
      return;
    }
    addedRef.current = {
      ...addedRef.current,
      [fieldId]: [...(addedRef.current[fieldId] ?? []), value],
    };
    setAdded(addedRef.current);
    startRefresh(() => router.refresh());
  }

  const shownFields = fields.map((f) =>
    added[f.id] && f.config.fieldType === 'enum'
      ? { ...f, config: { fieldType: 'enum' as const, choices: choicesOf(f, added) } }
      : f,
  );

  return (
    <div ref={panel} onKeyDown={onKeyDown}>
      <SlotEditor
        row={{
          id: stored.id,
          sortOrder: 0,
          capacity: draft.capacity !== undefined ? draft.capacity : stored.capacity,
          values: { ...toStringValues(stored.values), ...draft.values },
        }}
        fields={shownFields}
        onCellChange={editCell}
        onCapacity={(capacity) => {
          if (!busy) setDraft((d) => ({ ...d, capacity }));
        }}
        onAddEnumOption={addOption}
        onClose={() => finish(null)}
        onCancel={cancel}
        saving={busy}
      />
      {form.error ? (
        <div className="px-3.5 pb-3.5">
          <FormError>{form.error}</FormError>
        </div>
      ) : null}
    </div>
  );
}

/** A list field's choices, with those added here (`added`, by field id). */
function choicesOf(field: BuildField, added: Record<string, string[]>): string[] {
  const stored = field.config.fieldType === 'enum' ? field.config.choices : [];
  return [...stored, ...(added[field.id] ?? []).filter((c) => !stored.includes(c))];
}
