'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
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

/** What the slot list shares with its rows and the open slot's editor. */
export interface SlotEditing {
  signupId: string;
  fields: BuildField[];
  /** The slot whose editor is open. */
  openId: string | null;
  /** The slot that shows "Saved", from its last save. */
  savedId: string | null;
  /** The slot saved and waiting for the page to come back from the server. */
  landingId: string | null;
  Panel: Panel | null;
  loadFailed: boolean;
  /** The open editor's Done, once it has loaded. */
  finishRef: MutableRefObject<Finish | null>;
  toggle: (slotId: string) => void;
  prefetch: () => void;
  /** The open editor closed without saving; `next` opens instead, if given. */
  closed: (next: string | null) => void;
  /** The open editor saved `slotId`: refresh the page, then close it or open `next`. */
  saved: (slotId: string, next: string | null) => void;
  /** Refresh the page, as after a save that was only partly made. */
  refresh: () => void;
}

const SlotEditingContext = createContext<SlotEditing | null>(null);

/**
 * The review page's slot list, made editable: choosing a slot opens the
 * builder's slot editor under it (`ReviewSlotPanel`), one slot at a time.
 *
 * Once the editor has saved, this refreshes the page and waits for it to come
 * back before it closes the editor, so "Saved" never shows beside the old
 * values. The list waits, not the row: a save can move a slot to another
 * group, and its row is then a new one. Focus then goes back to the slot's
 * button, opening its group if that is folded; if the slot moved past the
 * fold and has no button, focus goes to the list. Choosing another slot while
 * one is open is Done for that one first; the other opens once it has saved,
 * and not if it was refused.
 */
export function ReviewSlotEditing({
  signupId,
  fields,
  id,
  className,
  children,
}: {
  signupId: string;
  /** Every field, as the builder holds them, passed in so this doesn't load the schema. */
  fields: BuildField[];
  /** The list's own id and classes. */
  id: string;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [landing, setLanding] = useState<{ slotId: string; next: string | null } | null>(null);
  const [Panel, setPanel] = useState<Panel | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const finishRef = useRef<Finish | null>(null);
  // The slot whose button gets focus back once its editor has closed.
  const refocus = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // The refresh has come back. The rows drawn with it already show the slot
  // closed and saved; this makes that the state.
  const landed = landing !== null && !refreshing ? landing : null;
  useEffect(() => {
    if (!landed) return;
    setLanding(null);
    setSavedId(landed.slotId);
    // The editor is loaded: it just saved.
    setOpenId(landed.next);
    if (!landed.next) refocus.current = landed.slotId;
  }, [landed]);

  useEffect(() => {
    if (openId !== null || refocus.current === null) return;
    const button = document.getElementById(rowButtonId(refocus.current));
    refocus.current = null;
    if (!button) {
      list.current?.focus();
      return;
    }
    const group = button.closest('details');
    if (group && !group.open) group.open = true;
    button.focus();
  });

  function prefetch() {
    if (Panel) return;
    if (loadFailed) setLoadFailed(false);
    loadPanel().then(
      (loaded) => setPanel(() => loaded),
      () => setLoadFailed(true),
    );
  }

  function show(slotId: string) {
    setOpenId(slotId);
    setSavedId((s) => (s === slotId ? null : s));
    prefetch();
  }

  function closed(next: string | null) {
    if (next) {
      show(next);
      return;
    }
    refocus.current = openId;
    setOpenId(null);
  }

  function toggle(slotId: string) {
    if (landing) return;
    if (openId === null) show(slotId);
    // The open editor finishes first: it saves, or refuses and stays open.
    else if (finishRef.current) finishRef.current(slotId === openId ? null : slotId);
    else if (slotId !== openId) show(slotId);
    // Still loading: choosing it again tries a failed load again, or closes it.
    else if (loadFailed) prefetch();
    else closed(null);
  }

  const refresh = () => startRefresh(() => router.refresh());

  return (
    <SlotEditingContext.Provider
      value={{
        signupId,
        fields,
        openId: landed ? landed.next : openId,
        savedId: landed ? landed.slotId : savedId,
        landingId: landing?.slotId ?? null,
        Panel,
        loadFailed,
        finishRef,
        toggle,
        prefetch,
        closed,
        saved: (slotId, next) => {
          setLanding({ slotId, next });
          refresh();
        },
        refresh,
      }}
    >
      <div ref={list} id={id} tabIndex={-1} className={className}>
        {children}
        {/* Always there, so "Saved" is read out as it appears, even when the
            save moved the slot and its row is a new one. Empty while a save
            waits, so the next one is read out too. */}
        <p role="status" className="sr-only">
          {landing === null && savedId !== null ? 'Saved' : ''}
        </p>
      </div>
    </SlotEditingContext.Provider>
  );
}

/**
 * One slot in the review page's list: the row as the server drew it, as a
 * button that opens the slot's editor under it. Its name is "Edit slot — "
 * and then what the row shows, so it holds what's on screen; the server adds
 * the group's value out of sight, so rows in different groups differ.
 */
export function ReviewSlotRow({ slot, children }: { slot: StoredSlot; children: ReactNode }) {
  const editing = useContext(SlotEditingContext);
  if (!editing) throw new Error('ReviewSlotRow needs ReviewSlotEditing around it');
  const { Panel, toggle, prefetch } = editing;
  const open = editing.openId === slot.id;
  const saved = editing.savedId === slot.id && !open;
  const panelId = `review-slot-editor-${slot.id}`;

  return (
    <li className={`rounded-lg border bg-white ${open ? 'border-brand' : 'border-surface-sunk'}`}>
      <div className="flex items-center">
        <button
          id={rowButtonId(slot.id)}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => toggle(slot.id)}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          className={`flex min-w-0 flex-1 items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-surface-raised/50 ${
            open ? 'rounded-t-lg' : 'rounded-lg'
          }`}
        >
          <span className="sr-only">{'Edit slot — '}</span>
          {children}
        </button>
        {saved ? (
          <span className="shrink-0 pr-3.5">
            <SavedNotice />
          </span>
        ) : null}
      </div>
      {open ? (
        <div id={panelId} className="rounded-b-lg border-t border-surface-sunk bg-surface-raised">
          {Panel ? (
            <Panel stored={slot} list={editing} />
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
