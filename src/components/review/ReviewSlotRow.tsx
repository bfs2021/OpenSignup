'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { BuildField } from '@/components/build-shared/useBuildState';
import { FormError } from '@/components/ui/form-error';
import { SavedNotice } from '@/components/ui/save-notice';
import { Spinner } from '@/components/ui/spinner';
import type { Finish, ReviewSlotPanel, StoredSlot } from './ReviewSlotPanel';

type Panel = typeof ReviewSlotPanel;

let panelChunk: Promise<Panel> | null = null;

/**
 * The open slot's editor, loaded the first time a slot is opened or pointed
 * at, as the share step loads its QR encoder, so it isn't part of the page's
 * first load. A failed load is tried again next time.
 */
function loadPanel(): Promise<Panel> {
  panelChunk ??= import('./ReviewSlotPanel').then(
    (m) => m.ReviewSlotPanel,
    (e: unknown) => {
      panelChunk = null;
      throw e;
    },
  );
  return panelChunk;
}

const rowButtonId = (slotId: string) => `review-slot-${slotId}`;

interface SlotEditing {
  signupId: string;
  fields: BuildField[];
  slots: StoredSlot[];
  /** The slot whose editor is open. */
  openId: string | null;
  /** The slot that shows "Saved", from its last save. */
  savedId: string | null;
  Panel: Panel | null;
  loadFailed: boolean;
  finishRef: MutableRefObject<Finish | null>;
  toggle: (slotId: string) => void;
  prefetch: () => void;
  closed: (saved: boolean, next: string | null) => void;
}

const SlotEditingContext = createContext<SlotEditing | null>(null);

/**
 * The review page's slot list, made editable: choosing a slot opens the
 * builder's slot editor under it (`ReviewSlotPanel`), one slot at a time.
 * Choosing another slot while one is open is Done for that one first; the
 * other opens once it has saved, and not if it was refused. Focus goes back
 * to a slot's button when its editor closes, and "Saved" shows beside it.
 */
export function ReviewSlotEditing({
  signupId,
  fields,
  slots,
  children,
}: {
  signupId: string;
  /** Every field, as the builder holds them, passed in so this doesn't load the schema. */
  fields: BuildField[];
  slots: StoredSlot[];
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [Panel, setPanel] = useState<Panel | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // The open editor's Done, once it has loaded.
  const finishRef = useRef<Finish | null>(null);
  // The slot whose button gets focus back once its editor has closed.
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    if (openId !== null || refocus.current === null) return;
    document.getElementById(rowButtonId(refocus.current))?.focus();
    refocus.current = null;
  });

  function prefetch() {
    if (Panel) return;
    if (loadFailed) setLoadFailed(false);
    loadPanel().then(
      (loaded) => setPanel(() => loaded),
      () => setLoadFailed(true),
    );
  }

  function show(id: string) {
    setOpenId(id);
    setSavedId((s) => (s === id ? null : s));
    prefetch();
  }

  function closed(saved: boolean, next: string | null) {
    if (saved) setSavedId(openId);
    if (next) {
      show(next);
      return;
    }
    refocus.current = openId;
    setOpenId(null);
  }

  function toggle(id: string) {
    if (openId === null) show(id);
    // The open editor finishes first: it saves, or refuses and stays open.
    else if (finishRef.current) finishRef.current(id === openId ? null : id);
    else if (id !== openId) show(id);
    // Still loading: choosing it again tries a failed load again, or closes it.
    else if (loadFailed) prefetch();
    else closed(false, null);
  }

  return (
    <SlotEditingContext.Provider
      value={{
        signupId,
        fields,
        slots,
        openId,
        savedId,
        Panel,
        loadFailed,
        finishRef,
        toggle,
        prefetch,
        closed,
      }}
    >
      {children}
    </SlotEditingContext.Provider>
  );
}

/**
 * One slot in the review page's list: the row as the server drew it, as a
 * button that opens the slot's editor under it. `label` names the button for
 * screen readers ("Edit slot — Fruit and water · 10:00 AM").
 */
export function ReviewSlotRow({
  slotId,
  label,
  children,
}: {
  slotId: string;
  label: string;
  children: ReactNode;
}) {
  const editing = useContext(SlotEditingContext);
  if (!editing) throw new Error('ReviewSlotRow needs ReviewSlotEditing around it');
  const { Panel, toggle, prefetch } = editing;
  const open = editing.openId === slotId;
  const saved = editing.savedId === slotId && !open;
  const stored = open ? editing.slots.find((s) => s.id === slotId) : undefined;
  const panelId = `review-slot-editor-${slotId}`;

  return (
    <li className={`rounded-lg border bg-white ${open ? 'border-brand' : 'border-surface-sunk'}`}>
      <div className="flex items-center">
        <button
          id={rowButtonId(slotId)}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={label}
          onClick={() => toggle(slotId)}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          className={`flex min-w-0 flex-1 items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-surface-raised/50 ${
            open ? 'rounded-t-lg' : 'rounded-lg'
          }`}
        >
          {children}
        </button>
        <div role="status" className={saved ? 'shrink-0 pr-3.5' : undefined}>
          {saved ? <SavedNotice /> : null}
        </div>
      </div>
      {open ? (
        <div id={panelId} className="rounded-b-lg border-t border-surface-sunk bg-surface-raised">
          {Panel && stored ? (
            <Panel
              signupId={editing.signupId}
              fields={editing.fields}
              stored={stored}
              onClosed={editing.closed}
              finishRef={editing.finishRef}
            />
          ) : editing.loadFailed ? (
            <div className="p-3.5">
              <FormError>Couldn’t open this slot. Try again.</FormError>
            </div>
          ) : (
            <div className="flex justify-center p-3.5 text-ink-soft">
              <Spinner />
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
