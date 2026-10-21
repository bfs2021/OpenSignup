'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { slotPatch, toStringValues, type SlotDraft } from '@/components/build-shared/slotValues';
import type { BuildField } from '@/components/build-shared/useBuildState';
import { SlotEditor } from '@/components/build-wysiwyg/SlotEditor';
import { FormError } from '@/components/ui/form-error';
import { patchField, patchSlot } from './patch-signup';
import type { SlotEditing } from './ReviewSlotRow';

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
 * An open slot on the review page: the builder's `SlotEditor`, with nothing
 * saved until Done. The changes, and any choice added to a list, stay here
 * until then; Cancel or Escape drops them. Done saves each list's new
 * choices through the field route, then the slot in one
 * `PATCH /api/slots/[id]` (`values` only if a value changed, `capacity` only
 * if that did), and hands over to the slot list, which refreshes the page and
 * closes this. Nothing changed, Done just closes. A refusal keeps it open
 * and says why. The changes are laid over the slot as the server last sent
 * it, so a refresh shows here too.
 *
 * Loaded only once a slot is opened (`ReviewSlotRow`), so none of this is in
 * the page's first load.
 */
export function ReviewSlotPanel({ stored, list }: { stored: StoredSlot; list: SlotEditing }) {
  const { signupId, fields } = list;
  const [draft, setDraft] = useState<SlotDraft>(NO_CHANGES);
  // Choices added to list fields, by field id, saved on Done.
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const busy = sending || list.landingId === stored.id;

  async function finish(next: string | null): Promise<void> {
    if (busy || inFlight.current) return;
    const choices = newChoices(fields, added);
    const body = slotPatch(stored, draft, fields);
    if (choices.length === 0 && !body) {
      list.closed(next);
      return;
    }
    inFlight.current = true;
    setSending(true);
    setError(null);
    let savedSome = false;
    const refuse = (reason: string) => {
      inFlight.current = false;
      setSending(false);
      setError(reason);
      // A list's new choice was saved before the slot was refused.
      if (savedSome) list.refresh();
    };
    // Only `config`, as the builder sends it: if the field's type changed
    // since this page loaded, the server refuses rather than changing it back.
    for (const { fieldId, config } of choices) {
      const refused = await patchField(signupId, fieldId, { config });
      if (refused) return refuse(refused);
      savedSome = true;
    }
    if (body) {
      const refused = await patchSlot(stored.id, body);
      if (refused) return refuse(refused);
    }
    list.saved(stored.id, next);
  }

  useEffect(() => {
    list.finishRef.current = (next) => void finish(next);
    return () => {
      list.finishRef.current = null;
    };
  });

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, [aria-haspopup="listbox"]')?.focus();
  }, []);

  const cancel = () => {
    if (!busy) list.closed(null);
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // An open list picker, or the box for a new choice, closes on its own.
    if ((e.target as HTMLElement).closest('[aria-expanded="true"], [role="listbox"]')) return;
    e.preventDefault();
    cancel();
  }

  return (
    <div ref={panel} onKeyDown={onKeyDown}>
      <SlotEditor
        row={{
          id: stored.id,
          sortOrder: 0,
          capacity: draft.capacity !== undefined ? draft.capacity : stored.capacity,
          values: { ...toStringValues(stored.values), ...draft.values },
        }}
        fields={fields.map((f) =>
          f.config.fieldType === 'enum' && added[f.id]
            ? { ...f, config: { ...f.config, choices: choicesOf(f, added) } }
            : f,
        )}
        onCellChange={(fieldRef, value) => {
          if (!busy) setDraft((d) => ({ ...d, values: { ...d.values, [fieldRef]: value } }));
        }}
        onCapacity={(capacity) => {
          if (!busy) setDraft((d) => ({ ...d, capacity }));
        }}
        onAddEnumOption={(fieldId, value) => {
          const field = fields.find((f) => f.id === fieldId);
          if (busy || !field) return;
          setAdded((a) =>
            choicesOf(field, a).includes(value)
              ? a
              : { ...a, [fieldId]: [...(a[fieldId] ?? []), value] },
          );
        }}
        onClose={() => void finish(null)}
        onCancel={cancel}
        saving={busy}
      />
      {error ? (
        <div className="px-3.5 pb-3.5">
          <FormError>{error}</FormError>
        </div>
      ) : null}
    </div>
  );
}

/** A list field's choices as the server has them, then those added here. */
function choicesOf(field: BuildField, added: Record<string, string[]>): string[] {
  const stored = field.config.fieldType === 'enum' ? field.config.choices : [];
  return [...stored, ...(added[field.id] ?? []).filter((c) => !stored.includes(c))];
}

/** Each list field with a choice added here that the server doesn't have yet, and its new config. */
function newChoices(fields: BuildField[], added: Record<string, string[]>) {
  return fields.flatMap((field) => {
    const { config } = field;
    if (config.fieldType !== 'enum') return [];
    const extra = (added[field.id] ?? []).filter((c) => !config.choices.includes(c));
    if (extra.length === 0) return [];
    return [{ fieldId: field.id, config: { ...config, choices: [...config.choices, ...extra] } }];
  });
}
