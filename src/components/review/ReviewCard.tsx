import type { ReactNode } from 'react';
import { Check, Pencil } from 'lucide-react';

/**
 * One card of the review page: a round mark on the left (a check; a pencil
 * while its Change form is open; "!" while it has something to fix), its
 * heading, and what it holds.
 * No hooks, so the server cards and the client ones share it.
 */
export function ReviewCard({
  heading,
  headingId,
  editing = false,
  attention = false,
  aside,
  action,
  children,
}: {
  heading: string;
  headingId: string;
  editing?: boolean;
  /** Something on the card needs fixing before the signup is published. */
  attention?: boolean;
  /** Next to the heading, such as "Saved". */
  aside?: ReactNode;
  /** Top right, such as the Change button. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      aria-labelledby={headingId}
      className={`flex gap-4 rounded-xl border bg-white px-4 py-4 shadow-card sm:px-5 ${
        editing ? 'border-brand' : 'border-surface-sunk'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          editing
            ? 'bg-brand-soft text-brand'
            : attention
              ? 'bg-warn/10 text-[15px] font-bold text-warn'
              : 'bg-success/10 text-success'
        }`}
      >
        {editing ? <Pencil size={13} /> : attention ? '!' : <Check size={15} strokeWidth={3} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-h-7 items-center gap-2.5">
          <h2
            id={headingId}
            className="text-xs font-bold tracking-[0.06em] text-ink-soft uppercase"
          >
            {heading}
          </h2>
          {aside}
          {action ? <div className="-my-1 ml-auto shrink-0">{action}</div> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

export const CHANGE_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-lg border border-surface-sunk bg-white px-3.5 text-[13px] font-medium text-ink transition hover:bg-surface-raised';

export const SAVE_BUTTON_CLASS =
  'inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:brightness-90';

export const CANCEL_BUTTON_CLASS =
  'inline-flex h-10 items-center rounded-lg border border-surface-sunk bg-white px-4 text-sm font-medium text-ink transition hover:bg-surface-raised';
