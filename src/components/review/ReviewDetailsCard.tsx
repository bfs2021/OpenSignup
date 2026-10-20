'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FormError } from '@/components/ui/form-error';
import { SavedNotice } from '@/components/ui/save-notice';
import {
  CANCEL_BUTTON_CLASS,
  CHANGE_BUTTON_CLASS,
  ReviewCard,
  SAVE_BUTTON_CLASS,
} from './ReviewCard';
import { patchSignup } from './patch-signup';

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
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaving(true);
    setError(null);
    const refused = await patchSignup(signupId, {
      title: String(form.get('title') ?? '').trim(),
      description: String(form.get('description') ?? '').trim(),
    });
    setSaving(false);
    if (refused) {
      setError(refused);
      return;
    }
    setEditing(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <ReviewCard
      heading="Name and description"
      headingId="review-details"
      editing={editing}
      aside={saved && !editing ? <SavedNotice role="status" /> : null}
      action={
        editing ? null : (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setSaved(false);
            }}
            className={CHANGE_BUTTON_CLASS}
            aria-label="Change name and description"
          >
            Change
          </button>
        )
      }
    >
      {editing ? (
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
          {error ? <FormError>{error}</FormError> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={SAVE_BUTTON_CLASS}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className={CANCEL_BUTTON_CLASS}
            >
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
