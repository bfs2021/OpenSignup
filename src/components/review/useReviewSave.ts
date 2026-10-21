'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Saves what it's given and answers null, or what to tell the organizer when
 * it wasn't saved (`patchSignup`, `patchSlot`).
 */
type Send = (body: unknown) => Promise<string | null>;

/**
 * A review page form: open it, save what it sends through `send`, and close
 * it once the page has re-rendered with the saved values, so "Saved" never
 * shows next to the old ones. A refusal keeps the form open and says why.
 * `onSaved` runs as it closes after a save.
 */
export function useReviewSave(send: Send, onSaved?: () => void) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const latest = useRef(onSaved);
  useEffect(() => {
    latest.current = onSaved;
  });

  useEffect(() => {
    if (!awaitingRefresh || refreshing) return;
    setAwaitingRefresh(false);
    setEditing(false);
    setSaved(true);
    latest.current?.();
  }, [awaitingRefresh, refreshing]);

  /** Resolves to whether it was saved. */
  async function save(body: unknown): Promise<boolean> {
    setSending(true);
    setError(null);
    const refused = await send(body);
    setSending(false);
    if (refused) {
      setError(refused);
      return false;
    }
    setAwaitingRefresh(true);
    startRefresh(() => router.refresh());
    return true;
  }

  return {
    editing,
    busy: sending || awaitingRefresh,
    saved: saved && !editing,
    error,
    refuse: setError,
    save,
    open: () => {
      setEditing(true);
      setSaved(false);
      setError(null);
    },
    cancel: () => {
      setEditing(false);
      setError(null);
    },
  };
}
