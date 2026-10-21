'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { applyDraftFixAction, undoDraftFixAction } from '@/app/app/(chrome)/signups/[id]/actions';
import { FormError } from '@/components/ui/form-error';
import { Spinner } from '@/components/ui/spinner';
import type { NoticeView } from '@/lib/draft-notices';
import type { DraftFixRequest, DraftFixUndo } from '@/schemas/draft-fixes';

const FIX_BUTTON_CLASS =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-brand/30 bg-white px-3.5 text-[13px] font-semibold text-brand transition hover:bg-brand-soft/40 disabled:cursor-not-allowed disabled:opacity-70';

/** What the last fix did, and its Undo until that's used or refused. */
interface LastFix {
  text: string;
  undo: DraftFixUndo | null;
}

/**
 * The review page's notices with their fixes: a button, or a box for a
 * field's name, that fixes the problem there and then, or a link to the
 * builder for the kinds that have none. Above them, what the last fix did and
 * Undo for it. The page comes back from the server with each fix, so this
 * holds no copy of the signup: only the last fix's undo, until the next fix
 * replaces it. That line stays when the list empties, so the last fix can
 * still be undone.
 */
export function NoticeFixes({
  signupId,
  heading,
  notices,
  builderHref,
  labelMaxLength,
}: {
  signupId: string;
  /** "2 things to fix before you publish". */
  heading: string;
  notices: NoticeView[];
  builderHref: string;
  /** The longest a field's name can be, passed in so this doesn't load the schema. */
  labelMaxLength: number;
}) {
  const [pending, startTransition] = useTransition();
  // The notice whose fix is in flight, or 'undo'. Read only while pending.
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<LastFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  // Where focus goes once the page is back: the button pressed has gone with
  // its notice, or Undo with its fix.
  const focusNext = useRef<'undo' | 'status' | null>(null);

  useEffect(() => {
    if (pending || focusNext.current === null) return;
    (focusNext.current === 'undo' ? undoButton : status).current?.focus();
    focusNext.current = null;
  }, [pending, last]);

  function fix(key: string, request: DraftFixRequest) {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      // A request that never got an answer, offline say, is said in words
      // rather than left to the page's error screen.
      const result = await applyDraftFixAction(signupId, request).catch(() => ({
        error: 'Couldn’t fix that. Try again.',
      }));
      startTransition(() => {
        // Nothing comes back when the action sent the browser elsewhere,
        // such as to sign in again.
        if (!result) return;
        if ('error' in result) {
          setError(result.error);
          return;
        }
        focusNext.current = 'undo';
        setLast({ text: result.done, undo: result.undo });
      });
    });
  }

  function undo(text: string, descriptor: DraftFixUndo) {
    setError(null);
    setBusy('undo');
    startTransition(async () => {
      const result = await undoDraftFixAction(signupId, descriptor).then(
        (refused) => ({ refused, failed: false }),
        () => ({ refused: null, failed: true }),
      );
      startTransition(() => {
        if (result.failed) {
          // Undo stays, to try again.
          setError('Couldn’t undo that. Try again.');
          return;
        }
        focusNext.current = 'status';
        // Refused: what the fix did stays said, without Undo.
        setLast({ text: result.refused ? text : 'Undone.', undo: null });
        if (result.refused) setError(result.refused.error);
      });
    });
  }

  function rename(e: FormEvent<HTMLFormElement>, key: string, fieldId: string) {
    e.preventDefault();
    const label = String(new FormData(e.currentTarget).get('label') ?? '');
    fix(key, { kind: 'unnamed_field', fieldId, label });
  }

  const spinner = (key: string) =>
    pending && busy === key ? <Spinner className="size-3.5 border-2" /> : null;

  function fixControl(notice: NoticeView) {
    const offer = notice.fix;
    if (!offer) {
      return (
        <Link href={builderHref} className={FIX_BUTTON_CLASS}>
          Fix in the builder
        </Link>
      );
    }
    if (offer.type === 'button') {
      return (
        <button
          type="button"
          aria-label={offer.name === offer.label ? undefined : offer.name}
          aria-busy={pending && busy === notice.key}
          disabled={pending}
          onClick={() => fix(notice.key, offer.request)}
          className={FIX_BUTTON_CLASS}
        >
          {spinner(notice.key)}
          {offer.label}
        </button>
      );
    }
    return (
      <form
        onSubmit={(e) => rename(e, notice.key, offer.fieldId)}
        className="flex min-w-0 flex-[1_1_260px] gap-2"
      >
        <input
          name="label"
          type="text"
          required
          maxLength={labelMaxLength}
          autoComplete="off"
          aria-label={offer.name}
          className="h-9 min-w-0 flex-1 rounded-lg border border-surface-sunk bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand sm:text-[14px]"
        />
        <button
          type="submit"
          aria-busy={pending && busy === notice.key}
          disabled={pending}
          className={FIX_BUTTON_CLASS}
        >
          {spinner(notice.key)}
          Save
        </button>
      </form>
    );
  }

  const lastUndo = last?.undo ?? null;
  return (
    <>
      {/* Out of the card's flow while empty, so it adds no gap, but always
          there, so what a fix did is read out as it appears. */}
      <div ref={status} role="status" tabIndex={-1} className={last ? 'outline-none' : 'sr-only'}>
        {last ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2 rounded-lg border border-surface-sunk bg-surface-raised px-3.5 py-2.5">
            <p className="min-w-0 text-[13.5px] leading-normal">{last.text}</p>
            {lastUndo ? (
              <button
                ref={undoButton}
                type="button"
                aria-busy={pending && busy === 'undo'}
                disabled={pending}
                onClick={() => undo(last.text, lastUndo)}
                className={FIX_BUTTON_CLASS}
              >
                {spinner('undo')}
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <FormError>{error}</FormError> : null}
      {notices.length === 0 ? (
        // Not under Magic Compose's own warnings, which the card shows just above.
        <p className="text-[13px] text-success group-has-[[data-ai-warnings]]/card:hidden">
          Nothing to fix. This is the list people will see.
        </p>
      ) : (
        <section aria-labelledby="review-notices" className="flex flex-col gap-2">
          <h3 id="review-notices" className="text-[13px] font-semibold text-warn">
            {heading}
          </h3>
          <ul className="flex flex-col gap-2">
            {notices.map((notice) => (
              <li
                key={notice.key}
                className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2.5 rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-3"
              >
                <p className="min-w-0 flex-[1_1_260px] text-[13.5px] leading-normal">
                  {notice.text}
                </p>
                {fixControl(notice)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
