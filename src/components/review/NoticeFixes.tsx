'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { applyDraftFixAction } from '@/app/app/(chrome)/signups/[id]/actions';
import type { NoticeView } from '@/lib/draft-notices';
import type { DraftFixRequest } from '@/schemas/draft-fixes';
import { BusySpinner, FIX_BUTTON_CLASS, useReviewChange } from './ReviewChanges';

/**
 * The review page's notices with their fixes: a button, or a box for a
 * field's name, that fixes the problem there and then, or a link to the
 * builder for the kinds that have none. What the last fix did, and Undo for
 * it, show on the card's line for its changes (`ReviewChanges`), which this
 * sits inside.
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
  const { pending, busy, change } = useReviewChange();

  function fix(key: string, request: DraftFixRequest) {
    change(key, () => applyDraftFixAction(signupId, request), 'Couldn’t fix that. Try again.');
  }

  function rename(e: FormEvent<HTMLFormElement>, key: string, fieldId: string) {
    e.preventDefault();
    const label = String(new FormData(e.currentTarget).get('label') ?? '');
    fix(key, { kind: 'unnamed_field', fieldId, label });
  }

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
          aria-busy={busy(notice.key)}
          disabled={pending}
          onClick={() => fix(notice.key, offer.request)}
          className={FIX_BUTTON_CLASS}
        >
          <BusySpinner show={busy(notice.key)} />
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
          placeholder="New name"
          aria-label={offer.name}
          className="h-9 min-w-0 flex-1 rounded-lg border border-surface-sunk bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand sm:text-[14px]"
        />
        <button
          type="submit"
          aria-busy={busy(notice.key)}
          disabled={pending}
          className={FIX_BUTTON_CLASS}
        >
          <BusySpinner show={busy(notice.key)} />
          Save
        </button>
      </form>
    );
  }

  if (notices.length === 0) {
    return (
      // Not under Magic Compose's own warnings, which the card shows just above.
      <p className="text-[13px] text-success group-has-[[data-ai-warnings]]/card:hidden">
        Nothing to fix. This is the list people will see.
      </p>
    );
  }
  return (
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
            <p className="min-w-0 flex-[1_1_260px] text-[13.5px] leading-normal">{notice.text}</p>
            {fixControl(notice)}
          </li>
        ))}
      </ul>
    </section>
  );
}
