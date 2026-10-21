import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { requireOrganizerSession, toActor } from '@/auth/session';
import { EmailDraftLink } from '@/components/review/EmailDraftLink';
import { ReviewDetailsCard } from '@/components/review/ReviewDetailsCard';
import { ReviewSignUpCard } from '@/components/review/ReviewSignUpCard';
import { ReviewSlotsCard } from '@/components/review/ReviewSlotsCard';
import { SignupLoadError } from '@/components/signup/SignupLoadError';
import { StatusPill } from '@/components/status-pill';
import { AsyncSubmitButton } from '@/components/ui/async-submit-button';
import { checkDraft } from '@/lib/draft-checks';
import { draftInputOf } from '@/lib/draft-fixes';
import { noticeView } from '@/lib/draft-notices';
import { hasFilledSlot, reminderReach, whatHappensOnSignUp } from '@/lib/signup-summary';
import { recordNoticesShown, trackOrganizerView } from '@/lib/view-tracker';
import {
  DESCRIPTION_MAX_LENGTH,
  REMINDER_BEFORE,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
  requiresEmail,
  sendsReminders,
} from '@/schemas/signups';
import { LABEL_MAX_LENGTH } from '@/schemas/slot-fields';
import { loadSignupForOrganizer } from '@/services/signups.cached';
import { emailDraftLinkAction, publishAction } from './actions';
import { signupMetadata } from './signup-metadata';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aiDraft?: string; all?: string }>;
};

export const generateMetadata = signupMetadata;

/**
 * A signup's own address. A draft with something in it opens on "Check your
 * signup, then share it": the signup as people will see it, the two settings
 * new organizers most often want, and Publish front and centre. Anything else
 * opens in the builder, as before: a published signup, and a draft with
 * nothing filled in yet, which needs building rather than checking.
 */
export default async function SignupPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  // Outside the tabs' layout, so it checks the session itself.
  const session = await requireOrganizerSession();
  const result = await loadSignupForOrganizer(toActor(session), id);
  if (!result.ok) return <SignupLoadError message={result.error.message} />;
  const sig = result.value;
  const { aiDraft, all } = await searchParams;
  const slots = sig.slots.map((s) => ({
    id: s.id,
    values: (s.values as Record<string, unknown>) ?? {},
    capacity: s.capacity,
    status: s.status,
  }));

  // A Magic Compose landing keeps its flag on the way to the builder, so the
  // builder's banner shows the draft's warnings where they can be fixed.
  const builderHref = `/app/signups/${id}/build${aiDraft === '1' ? '?aiDraft=1' : ''}`;
  if (sig.status !== 'draft' || !hasFilledSlot({ fields: sig.fields, slots })) {
    redirect(builderHref);
  }

  // Every slot is checked, not only the ones the fold shows. A fix checks
  // again through the same `draftInputOf`, so it finds what this showed.
  const found = checkDraft(draftInputOf({ fields: sig.fields, slots, settings: sig.settings }));
  const notices = found.map((n) => noticeView(n, { fields: sig.fields, slots }));

  const actor = { actorId: session.organizerId, actorType: 'organizer' } as const;
  await trackOrganizerView({
    actor,
    signupId: sig.id,
    workspaceId: sig.workspaceId,
    eventType: 'signup.editor_opened',
    payload: { section: 'review' },
  });
  if (found.length > 0) {
    after(() =>
      recordNoticesShown({
        actor,
        signupId: sig.id,
        workspaceId: sig.workspaceId,
        kinds: found.map((n) => n.kind),
      }),
    );
  }

  // Both read malformed settings as their defaults rather than failing.
  const requireEmail = requiresEmail(sig.settings);
  const sendReminders = sendsReminders(sig.settings);
  const hasDates = sig.slots.some((s) => s.slotAt !== null);
  const previewHref = `/app/signups/${id}/preview`;

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2">
        <div>
          <StatusPill status={sig.status} />
        </div>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-balance sm:text-3xl">
          Check your signup, then share it
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          Only you can see it until you publish. You can still change anything afterwards.{' '}
          <Link
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand hover:underline"
          >
            Preview the page
          </Link>
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        <ReviewDetailsCard
          signupId={id}
          title={sig.title}
          description={sig.description}
          limits={{
            titleMin: TITLE_MIN_LENGTH,
            titleMax: TITLE_MAX_LENGTH,
            descriptionMax: DESCRIPTION_MAX_LENGTH,
          }}
        />
        <ReviewSlotsCard
          signupId={id}
          fields={sig.fields}
          slots={slots}
          settings={sig.settings}
          showAll={all === '1'}
          builderHref={builderHref}
          notices={notices}
          labelMaxLength={LABEL_MAX_LENGTH}
        />
        <ReviewSignUpCard
          signupId={id}
          summary={whatHappensOnSignUp({
            requireEmail,
            reminders: reminderReach(sendReminders, sig.slots),
            before: REMINDER_BEFORE,
          })}
          requireEmail={requireEmail}
          sendReminders={sendReminders}
          hasDates={hasDates}
          before={REMINDER_BEFORE}
        />
      </ol>

      <div className="flex flex-col gap-3 pt-1">
        <form action={publishAction.bind(null, id)}>
          <AsyncSubmitButton
            loadingLabel="Publishing…"
            className="bg-brand inline-flex h-[54px] w-full items-center justify-center rounded-[14px] text-base font-semibold text-white shadow-[0_1px_2px_rgba(31,111,235,0.2),0_6px_18px_rgba(31,111,235,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:brightness-90"
          >
            Publish and get the link
          </AsyncSubmitButton>
        </form>
        <Link
          href={builderHref}
          className="self-start text-sm font-medium text-brand hover:underline"
        >
          Edit everything in the builder
        </Link>
        <EmailDraftLink action={emailDraftLinkAction.bind(null, id)} />
      </div>
    </div>
  );
}
