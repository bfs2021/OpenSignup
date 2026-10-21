'use client';

import { Check, Copy, Hash, Trash2 } from 'lucide-react';
import { FIELD_TYPE_META, FIELD_VALUE_INPUT_CLASS, FIELD_VALUE_INPUTS } from '../build-shared/fieldTypes';
import { EnumPicker } from './EnumPicker';
import type { BuildField, BuildRow } from '../build-shared/useBuildState';

type SlotEditorProps = {
  row: BuildRow;
  fields: BuildField[];
  onCellChange: (fieldRef: string, value: string) => void;
  onCapacity: (capacity: number | null) => void;
  /**
   * Append `value` to the field's enum choices config. Only called for enum
   * cells. May return a promise; EnumPicker awaits it before committing the
   * cell value so the field-config PATCH always lands first.
   */
  onAddEnumOption: (fieldId: string, value: string) => void | Promise<void>;
  /** Without it, there is no Duplicate button (the review page has none). */
  onDuplicate?: () => void;
  /** Without it, there is no Delete button (the review page has none). */
  onDelete?: () => void;
  /** Done: the builder closes the slot; the review page saves it first. */
  onClose: () => void;
  /**
   * Where the editor saves only on Done (the review page), Cancel throws the
   * changes away. The builder saves as it goes, so it has none.
   */
  onCancel?: () => void;
  /** Done is saving: it says so, and neither button can be pressed again. */
  saving?: boolean;
};

/**
 * Inline accordion editor for a single slot. Auto-fit grid keeps small
 * schemas tight while letting wider schemas wrap naturally; capacity rides
 * along as the trailing cell so it lives in the same visual band.
 */
export function SlotEditor({
  row,
  fields,
  onCellChange,
  onCapacity,
  onAddEnumOption,
  onDuplicate,
  onDelete,
  onClose,
  onCancel,
  saving = false,
}: SlotEditorProps) {
  return (
    <div className="px-3.5 pb-3.5 pt-3" data-testid={`slot-editor-${row.id}`}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-soft">
          Editing slot
        </span>
        <div className="flex gap-1">
          {onDuplicate ? (
            <button
              type="button"
              onClick={onDuplicate}
              className="inline-flex items-center gap-1 rounded-md border-none bg-transparent px-1.5 py-1 text-[11px] font-medium text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              <Copy size={11} />
              Duplicate
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-md border-none bg-transparent px-1.5 py-1 text-[11px] font-medium text-danger hover:bg-danger/10"
            >
              <Trash2 size={11} />
              Delete
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="inline-flex items-center rounded-md border-none bg-transparent px-1.5 py-1 text-[11px] font-medium text-ink-muted hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border-none bg-transparent px-1.5 py-1 text-[11px] font-medium text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check size={11} />
            {saving ? 'Saving\u2026' : 'Done'}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
        {fields.map((f) => {
          const fieldType = f.config.fieldType;
          const TypeIcon = FIELD_TYPE_META[fieldType].icon;
          // A list cell is a div, not a label. A label passes every click inside
          // it on to its first control, the picker's trigger. Picking an option
          // or "Add to list" removes the clicked button before the browser checks
          // where the click came from, so the click reached the trigger too:
          // picking reopened the menu, and "Add to list" closed its input as
          // soon as it appeared. The trigger has its own aria-label.
          const Cell = fieldType === 'enum' ? 'div' : 'label';
          return (
            <Cell
              key={f.id}
              className="flex flex-col gap-1 text-[11px] text-ink-muted"
            >
              <span className="inline-flex items-center gap-1">
                <TypeIcon size={10} className="text-ink-soft" />
                {f.name}
              </span>
              {f.config.fieldType === 'enum' ? (
                <EnumPicker
                  value={row.values[f.ref] ?? ''}
                  options={f.config.choices}
                  ariaLabel={`${f.name} value`}
                  onChange={(v) => onCellChange(f.ref, v)}
                  onAddOption={(v) => onAddEnumOption(f.id, v)}
                />
              ) : (
                <input
                  {...FIELD_VALUE_INPUTS[f.config.fieldType]}
                  value={row.values[f.ref] ?? ''}
                  onChange={(e) => onCellChange(f.ref, e.target.value)}
                  className={FIELD_VALUE_INPUT_CLASS}
                  aria-label={`${f.name} value`}
                />
              )}
            </Cell>
          );
        })}
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <Hash size={10} className="text-ink-soft" />
            Capacity
          </span>
          <input
            type="number"
            min={1}
            value={row.capacity ?? ''}
            placeholder={'\u221e'}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onCapacity(null);
                return;
              }
              const parsed = parseInt(raw, 10);
              onCapacity(Math.max(1, Number.isFinite(parsed) ? parsed : 1));
            }}
            aria-label="Capacity"
            className="w-20 rounded-md border border-surface-sunk bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brand"
          />
        </label>
      </div>
    </div>
  );
}
