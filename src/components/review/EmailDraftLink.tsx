'use client';

import { useActionState } from 'react';
import { AsyncSubmitButton } from '@/components/ui/async-submit-button';
import { FormError } from '@/components/ui/form-error';

/** What "Email me a link to finish later" came to: sent, refused with why, or not pressed yet. */
export type EmailDraftLinkState = { sent: true } | { error: string } | null;

/**
 * "Not yet. Email me a link to finish later" under the review page's actions.
 * The action sends the draft email now and answers here, without reloading
 * the page, so it isn't counted as a second view of it.
 */
export function EmailDraftLink({
  action,
}: {
  action: (state: EmailDraftLinkState, form: FormData) => Promise<EmailDraftLinkState>;
}) {
  const [state, formAction] = useActionState(action, null);
  if (state && 'sent' in state) {
    return (
      <p role="status" className="text-sm font-medium text-success">
        Sent. Check your email.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <AsyncSubmitButton
        loadingLabel="Sending…"
        className="text-sm font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-70"
      >
        Not yet. Email me a link to finish later
      </AsyncSubmitButton>
      {state && 'error' in state ? <FormError>{state.error}</FormError> : null}
    </form>
  );
}
