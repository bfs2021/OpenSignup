import { SignupStateMessage } from '@/app/s/[slug]/state-message';
import { FormError } from '@/components/ui/form-error';
import { UnsubscribeCard } from '@/components/unsubscribe-card';
import { getDb } from '@/db/client';
import { previewDraftEmailOptOut } from '@/services/draft-email-optout';

// Reads the database on every request; never prerendered.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Draft emails',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ o?: string; token?: string; done?: 'on' | 'off'; error?: string }>;
};

/**
 * Where the link in the email about an unpublished draft lands: confirm, then
 * the form POSTs to `/api/public/draft-email-optout`, so a link scanner opening
 * the URL turns nothing off. No sign-in: the token in the link stands in for
 * it, as on a participant's reminder unsubscribe page, and the outcome shown is
 * read from the organizer's row, never from `done` alone.
 */
export default async function DraftEmailUnsubscribePage({ searchParams }: PageProps) {
  const { o: organizerId, token, done, error } = await searchParams;

  if (!organizerId || !token) {
    return (
      <SignupStateMessage
        title="This link is incomplete"
        body="Unsubscribe links only work in full. Open the link straight from the email about your draft."
      />
    );
  }

  const result = await previewDraftEmailOptOut(getDb(), organizerId, token);
  if (!result.ok) {
    return (
      <SignupStateMessage
        title="This link isn't valid"
        body="It may have been mangled in transit. Open the link straight from the email about your draft."
      />
    );
  }
  const target = result.value;

  const credentials = (
    <>
      <input type="hidden" name="o" value={target.organizerId} />
      <input type="hidden" name="token" value={token} />
      {/* Marks a person's submit, as against a mail provider's one-click POST. */}
      <input type="hidden" name="page" value="1" />
    </>
  );

  if (target.optedOut) {
    return (
      <UnsubscribeCard title={done === 'off' ? 'Draft emails turned off' : 'Draft emails are off'}>
        {error ? (
          <FormError>That didn&apos;t work — nothing has changed. Try again below.</FormError>
        ) : null}
        <p className="text-sm text-ink-muted">
          We won&apos;t email {target.email} about signups you start and don&apos;t publish. Your
          drafts are unchanged, and you&apos;ll still get sign-in emails.
        </p>
        <form action="/api/public/draft-email-optout" method="post">
          {credentials}
          <input type="hidden" name="action" value="start" />
          <button type="submit" className="text-sm text-brand underline">
            Turn them back on
          </button>
        </form>
        <a href="/app" className="text-sm text-brand underline">
          Go to your signups
        </a>
      </UnsubscribeCard>
    );
  }

  return (
    <UnsubscribeCard
      title={
        done === 'on' ? 'Draft emails turned back on' : 'Stop emails about unpublished drafts?'
      }
    >
      {error ? (
        <FormError>That didn&apos;t work — nothing has changed. Try again below.</FormError>
      ) : null}
      <p className="text-sm text-ink-muted">
        {done === 'on' ? (
          <>
            When you start a signup and don&apos;t publish it, we&apos;ll email {target.email} once,
            a few hours later, with a link back to it.
          </>
        ) : (
          <>
            We&apos;ll stop emailing {target.email} about signups you start and don&apos;t publish.
            This covers all your drafts. The drafts themselves stay as they are.
          </>
        )}
      </p>
      {done === 'on' ? (
        <a href="/app" className="text-sm text-brand underline">
          Go to your signups
        </a>
      ) : (
        <form action="/api/public/draft-email-optout" method="post" className="flex gap-3">
          {credentials}
          <button
            type="submit"
            className="rounded-lg bg-brand px-5 py-2 font-medium text-white transition hover:brightness-110"
          >
            Stop these emails
          </button>
          <a
            href="/app"
            className="rounded-lg border border-surface-sunk px-5 py-2 font-medium transition hover:bg-surface-sunk/40"
          >
            Keep them
          </a>
        </form>
      )}
    </UnsubscribeCard>
  );
}
