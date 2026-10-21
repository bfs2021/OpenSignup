'use client';

import type { FormEvent } from 'react';
import { FormError } from '@/components/ui/form-error';
import { SavedNotice } from '@/components/ui/save-notice';
import {
  CANCEL_BUTTON_CLASS,
  CHANGE_BUTTON_CLASS,
  ReviewCard,
  SAVE_BUTTON_CLASS,
} from './ReviewCard';
import { useReviewSave } from './useReviewSave';

const INPUT_CLASS =
  'w-full rounded-lg border border-surface-sunk bg-white px-3 text-[15px] text-ink focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none';

/** The review page's "Name and description" card, with its Change form. */
export function ReviewDetailsCard({
  signupId,
  title,
  description,
  limits,
}: {
  signupId: string;
  title: string;
  description: string;
  /** The schema's lengths, passed in so this island doesn't load the schema. */
  limits: { titleMin: number; titleMax: number; descriptionMax: number };
}) {
  const form = useReviewSave(signupId);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const nextTitle = String(data.get('title') ?? '').trim();
    // The browser checks the length before trimming; the server, after.
    if (nextTitle.length < limits.titleMin) {
      form.refuse(`The name needs at least ${limits.titleMin} letters.`);
      return;
    }
    void form.save({
      title: nextTitle,
      description: String(data.get('description') ?? '').trim(),
    });
  }

  return (
    <ReviewCard
      heading="Name and description"
      headingId="review-details"
      editing={form.editing}
      aside={form.saved ? <SavedNotice role="status" /> : null}
      action={
        form.editing ? null : (
          <button
            type="button"
            onClick={form.open}
            className={CHANGE_BUTTON_CLASS}
            aria-label="Change name and description"
          >
            Change
          </button>
        )
      }
    >
      {form.editing ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3.5 pt-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Name</span>
            <input
              name="title"
              type="text"
              required
              minLength={limits.titleMin}
              maxLength={limits.titleMax}
              defaultValue={title}
              className={`${INPUT_CLASS} h-11`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Description</span>
            <textarea
              name="description"
              rows={3}
              maxLength={limits.descriptionMax}
              defaultValue={description}
              className={`${INPUT_CLASS} py-2.5 text-sm leading-relaxed`}
            />
          </label>
          {form.error ? <FormError>{form.error}</FormError> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={form.busy} className={SAVE_BUTTON_CLASS}>
              {form.busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={form.cancel} className={CANCEL_BUTTON_CLASS}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold break-words">{title}</p>
          {description ? (
            <p className="text-sm leading-relaxed whitespace-pre-line break-words text-ink-muted">
              {description}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">No description yet.</p>
          )}
        </div>
      )}
    </ReviewCard>
  );
}
