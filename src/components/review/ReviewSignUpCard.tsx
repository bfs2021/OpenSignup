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

/**
 * The review page's "What happens when someone signs up" card: whether the
 * sign-up form asks for an email, and whether reminders go out. Reminders can
 * be switched only when some slot has a date to time them from; otherwise
 * there is nothing to switch, and the card says no reminders go out.
 */
export function ReviewSignUpCard({
  signupId,
  summary,
  requireEmail,
  sendReminders,
  hasDates,
  before,
}: {
  signupId: string;
  /** What happens now, in words (`whatHappensOnSignUp`), from the server. */
  summary: string;
  requireEmail: boolean;
  sendReminders: boolean;
  hasDates: boolean;
  /** When a reminder goes out, such as "the day before". */
  before: string;
}) {
  const form = useReviewSave(signupId);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    // Only what this form shows: `updateSignup` merges it over the rest.
    const settings: Record<string, boolean> = {
      requireEmail: data.get('requireEmail') !== 'optional',
    };
    if (hasDates) settings.sendReminders = data.get('sendReminders') === 'on';
    void form.save({ settings });
  }

  return (
    <ReviewCard
      heading="What happens when someone signs up"
      headingId="review-sign-up"
      editing={form.editing}
      aside={form.saved ? <SavedNotice role="status" /> : null}
      action={
        form.editing ? null : (
          <button
            type="button"
            onClick={form.open}
            className={CHANGE_BUTTON_CLASS}
            aria-label="Change what happens when someone signs up"
          >
            Change
          </button>
        )
      }
    >
      <p className="text-sm leading-relaxed">{summary}</p>
      {form.editing ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3.5 pt-1.5">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1.5 text-[13px] font-semibold">Ask for an email address</legend>
            <label className="flex min-h-9 items-center gap-2.5 text-sm">
              <input
                type="radio"
                name="requireEmail"
                value="required"
                defaultChecked={requireEmail}
                className="accent-brand h-[18px] w-[18px]"
              />
              Required. Everyone gets their link to change or cancel.
            </label>
            <label className="flex min-h-9 items-center gap-2.5 text-sm">
              <input
                type="radio"
                name="requireEmail"
                value="optional"
                defaultChecked={!requireEmail}
                className="accent-brand h-[18px] w-[18px]"
              />
              Optional. People without one get no emails.
            </label>
          </fieldset>
          {hasDates ? (
            <label className="flex min-h-10 items-center gap-2.5 rounded-lg bg-surface-raised px-3 text-sm">
              <input
                type="checkbox"
                name="sendReminders"
                defaultChecked={sendReminders}
                className="accent-brand h-[18px] w-[18px]"
              />
              Send a reminder {before} each slot
            </label>
          ) : null}
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
      ) : null}
    </ReviewCard>
  );
}
