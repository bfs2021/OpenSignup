'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  removeDayAction,
  setCapacityAction,
  undoDraftFixAction,
} from '@/app/app/(chrome)/signups/[id]/actions';
import { FormError } from '@/components/ui/form-error';
import { Spinner } from '@/components/ui/spinner';
import type { DraftFixUndo, RemoveDayRequest } from '@/schemas/draft-fixes';

export const FIX_BUTTON_CLASS =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-brand/30 bg-white px-3.5 text-[13px] font-semibold text-brand transition hover:bg-brand-soft/40 disabled:cursor-not-allowed disabled:opacity-70';

/**
 * A change's answer: what it did and its undo (null when nothing was done),
 * or why it was refused. Nothing when the action sent the browser elsewhere,
 * such as to sign in again.
 */
type Answer = { done: string; undo: DraftFixUndo | null } | { error: string } | undefined;

/** What the last change did, and its Undo until that's used or refused. */
interface LastChange {
  text: string;
  undo: DraftFixUndo | null;
}

/**
 * Why the last change or Undo was refused. `key` is the control that shows it
 * beside itself; null for the card's line.
 */
interface Refusal {
  text: string;
  key: string | null;
}

/** Runs before a change; false stops it. */
type BeforeChange = () => Promise<boolean>;

interface ReviewChange {
  /** A change or an Undo is in flight: every control that makes one waits. */
  pending: boolean;
  /** Whether the control `key` made the change in flight. */
  busy: (key: string) => boolean;
  /**
   * Makes a change: `send` asks the server for it; `failed` is what to say
   * when no answer comes back, offline say. With `own`, a refusal shows
   * beside the control `key` (`refusalFor`) rather than on the card's line.
   */
  change: (key: string, send: () => Promise<Answer>, failed: string, own?: boolean) => void;
  refusalFor: (key: string) => Refusal | null;
  /** The control `key` is gone: a refusal it showed moves to the card's line. */
  release: (key: string) => void;
  /** Sets what runs before every change and Undo; returns its removal. */
  registerBeforeChange: (run: BeforeChange) => () => void;
}

const ReviewChangeContext = createContext<ReviewChange | null>(null);

export function useReviewChange(): ReviewChange {
  const context = useContext(ReviewChangeContext);
  if (!context) throw new Error('needs ReviewChanges around it');
  return context;
}

/**
 * Has `run` go first whenever a change or an Undo is made on the card, if
 * there is a `ReviewChanges` around the caller: the slot list finishes its
 * open slot with it. When `run` answers false, the change isn't made.
 */
export function useBeforeChange(run: BeforeChange): void {
  const register = useContext(ReviewChangeContext)?.registerBeforeChange;
  useEffect(() => register?.(run));
}

/** A spinner on the control whose change is in flight. */
export function BusySpinner({ show }: { show: boolean }) {
  return show ? <Spinner className="size-3.5 border-2" /> : null;
}

/**
 * The review page's slots card, for the changes made on it: the notices'
 * one-tap fixes (`NoticeFixes`), Remove day (`RemoveDayButton`, below) and
 * "People for each slot" (`PeopleForEachSlot`, below, in `header`, which
 * shows above the line). It holds what the last change did and Undo for it,
 * on one line above the notices, so a Remove day replaces a fix's Undo and
 * the other way round.
 * The page comes back from the server with each change, so this holds no
 * copy of the signup: only the last change's undo, until the next change
 * replaces it. That line stays when the notices empty, so the last change
 * can still be undone.
 *
 * Before a change or an Undo is sent, a slot open in the list below is
 * finished first, as choosing another slot does (`useBeforeChange`): saved,
 * or, when its save is refused, left open saying why, and the change isn't
 * made. A change can fold rows away or remove them, and a slot's unsaved
 * changes would go with its row.
 *
 * After a change, focus goes to Undo, as the button pressed has gone with
 * its notice or its day; after Undo, or a change that did nothing, to the
 * line. What's inside stays as the server drew it.
 */
export function ReviewChanges({
  signupId,
  header,
  children,
}: {
  signupId: string;
  /** Shown above the line: the card's headline, with "People for each slot". */
  header?: ReactNode;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  // The control whose change is in flight, or 'undo'. Read only while pending.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [last, setLast] = useState<LastChange | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const status = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  // Where focus goes once the page is back.
  const focusNext = useRef<'undo' | 'status' | null>(null);
  const beforeChange = useRef<BeforeChange | null>(null);

  useEffect(() => {
    if (pending || focusNext.current === null) return;
    (focusNext.current === 'undo' ? undoButton : status).current?.focus();
    focusNext.current = null;
  }, [pending, last]);

  const registerBeforeChange = useCallback((run: BeforeChange) => {
    beforeChange.current = run;
    return () => {
      if (beforeChange.current === run) beforeChange.current = null;
    };
  }, []);

  const release = useCallback(
    (key: string) => setRefusal((r) => (r?.key === key ? { ...r, key: null } : r)),
    [],
  );

  /** False when the open slot's save was refused: it says why, and nothing more is done. */
  const ready = () => (beforeChange.current?.() ?? Promise.resolve(true)).catch(() => false);

  function change(key: string, send: () => Promise<Answer>, failed: string, own = false) {
    setRefusal(null);
    setBusyKey(key);
    startTransition(async () => {
      if (!(await ready())) return;
      // A request that never got an answer is said in words rather than left
      // to the page's error screen.
      const result = await send().catch(() => ({ error: failed }));
      startTransition(() => {
        if (!result) return;
        if ('error' in result) {
          setRefusal({ text: result.error, key: own ? key : null });
          return;
        }
        focusNext.current = result.undo ? 'undo' : 'status';
        setLast({ text: result.done, undo: result.undo });
      });
    });
  }

  function undo(text: string, descriptor: DraftFixUndo) {
    setRefusal(null);
    setBusyKey('undo');
    startTransition(async () => {
      if (!(await ready())) return;
      const result = await undoDraftFixAction(signupId, descriptor).then(
        (refused) => ({ refused, failed: false }),
        () => ({ refused: null, failed: true }),
      );
      startTransition(() => {
        if (result.failed) {
          // Undo stays, to try again.
          setRefusal({ text: 'Couldn’t undo that. Try again.', key: null });
          return;
        }
        focusNext.current = 'status';
        // Refused: what the change did stays said, without Undo.
        setLast({ text: result.refused ? text : 'Undone.', undo: null });
        if (result.refused) setRefusal({ text: result.refused.error, key: null });
      });
    });
  }

  const busy = (key: string) => pending && busyKey === key;
  const refusalFor = (key: string) => (refusal?.key === key ? refusal : null);
  const lastUndo = last?.undo ?? null;
  return (
    <ReviewChangeContext.Provider
      value={{ pending, busy, change, refusalFor, release, registerBeforeChange }}
    >
      {header}
      {/* Out of the card's flow while empty, so it adds no gap, but always
          there, so what a change did is read out as it appears. */}
      <div ref={status} role="status" tabIndex={-1} className={last ? 'outline-none' : 'sr-only'}>
        {last ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2 rounded-lg border border-surface-sunk bg-surface-raised px-3.5 py-2.5">
            <p className="min-w-0 text-[13.5px] leading-normal">{last.text}</p>
            {lastUndo ? (
              <button
                ref={undoButton}
                type="button"
                aria-busy={busy('undo')}
                disabled={pending}
                onClick={() => undo(last.text, lastUndo)}
                className={FIX_BUTTON_CLASS}
              >
                <BusySpinner show={busy('undo')} />
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {refusal && refusal.key === null ? <FormError>{refusal.text}</FormError> : null}
      {children}
    </ReviewChangeContext.Provider>
  );
}

/**
 * Remove day, in a date's group on the review page: deletes every slot of
 * that day, folded or not, and says so with Undo on the card's line for its
 * changes. In the group, not in its header, which opens and closes it.
 * `name` names the day, as several groups each have one. A refusal shows
 * here, under the button, and takes focus, so it isn't missed at the top of
 * a long list; if the day is gone from the page that came back, it shows on
 * the card's line instead.
 */
export function RemoveDayButton({
  signupId,
  request,
  name,
}: {
  signupId: string;
  /** Made on the server, so the schema stays there. */
  request: RemoveDayRequest;
  name: string;
}) {
  const { pending, busy, change } = useReviewChange();
  const key = `remove_day:${request.value}`;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        aria-label={name}
        aria-busy={busy(key)}
        disabled={pending}
        onClick={() =>
          change(
            key,
            () => removeDayAction(signupId, request),
            'Couldn’t remove that day. Try again.',
            true,
          )
        }
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-surface-sunk bg-white px-3.5 text-[13px] font-medium text-ink transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-70"
      >
        <BusySpinner show={busy(key)} />
        Remove day
      </button>
      <OwnRefusal control={key} />
    </div>
  );
}

const PEOPLE_EACH = 'set_capacity';

/**
 * "People for each slot", beside the headline over the review page's slots
 * (issue #504): a number box and Set, which gives every slot of the draft
 * that many people at once, and says so with Undo on the card's line for its
 * changes. A refusal shows here, under the box, and takes focus, as Remove
 * day's does.
 *
 * The box starts with the number every slot takes when they all take the
 * same one (`shared`), and empty otherwise. It takes a whole number, 1 or
 * more: no limit is set slot by slot. `fingerprint` stands for every slot the
 * page showed, so nothing is set on slots the organizer didn't see; `max` is
 * the most a slot can take, passed in so this doesn't load the schema. One
 * per page, so its box has a fixed id.
 */
export function PeopleForEachSlot({
  signupId,
  fingerprint,
  shared,
  max,
}: {
  signupId: string;
  fingerprint: string;
  shared: number | null;
  max: number;
}) {
  const { pending, busy, change } = useReviewChange();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The server says what's wrong with anything that isn't a whole number.
    const capacity = Number(new FormData(e.currentTarget).get('capacity'));
    change(
      PEOPLE_EACH,
      () => setCapacityAction(signupId, { kind: 'set_capacity', capacity, fingerprint }),
      'Couldn’t set that. Try again.',
      true,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <label htmlFor="people-each" className="text-[13px] text-ink-muted">
          People for each slot
        </label>
        <span className="flex gap-2">
          <input
            // Starts again from what the page now shows once it comes back
            // changed, as after Undo.
            key={shared ?? ''}
            id="people-each"
            name="capacity"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={max}
            step={1}
            defaultValue={shared ?? ''}
            className="h-9 w-20 rounded-lg border border-surface-sunk bg-white px-2.5 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand sm:text-[14px]"
          />
          <button
            type="submit"
            aria-busy={busy(PEOPLE_EACH)}
            disabled={pending}
            className={FIX_BUTTON_CLASS}
          >
            <BusySpinner show={busy(PEOPLE_EACH)} />
            Set
          </button>
        </span>
      </form>
      <OwnRefusal control={PEOPLE_EACH} />
    </div>
  );
}

/**
 * Why the change the control `control` made was refused, under that control
 * (a change made with `own`), taking focus as it appears, so it isn't missed
 * at the top of a long card. Rendered with the control: once the control is
 * gone, the refusal moves to the card's line.
 */
function OwnRefusal({ control }: { control: string }) {
  const { refusalFor, release } = useReviewChange();
  const refusal = refusalFor(control);
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (refusal) alert.current?.focus();
  }, [refusal]);
  useEffect(() => () => release(control), [release, control]);

  return refusal ? (
    <div ref={alert} tabIndex={-1} className="self-stretch outline-none">
      <FormError>{refusal.text}</FormError>
    </div>
  ) : null;
}
