'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { patchSignup } from './patch-signup';

/**
 * A review card's Change form: open it, save what it sends through
 * `PATCH /api/signups/[id]`, and close it once the page has re-rendered with
 * the saved values, so "Saved" never shows next to the old ones. A refusal
 * keeps the form open and says why.
 */
export function useReviewSave(signupId: string) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    if (!awaitingRefresh || refreshing) return;
    setAwaitingRefresh(false);
    setEditing(false);
    setSaved(true);
  }, [awaitingRefresh, refreshing]);

  async function save(body: unknown): Promise<void> {
    setSending(true);
    setError(null);
    const refused = await patchSignup(signupId, body);
    setSending(false);
    if (refused) {
      setError(refused);
      return;
    }
    setAwaitingRefresh(true);
    startRefresh(() => router.refresh());
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
    },
    cancel: () => {
      setEditing(false);
      setError(null);
    },
  };
}
