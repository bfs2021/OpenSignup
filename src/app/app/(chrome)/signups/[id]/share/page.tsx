import { redirect } from 'next/navigation';
import { requireOrganizerSession, toActor } from '@/auth/session';
import { ShareStep } from '@/components/share/ShareStep';
import { SignupLoadError } from '@/components/signup/SignupLoadError';
import { publicSignupUrl } from '@/lib/links';
import { trackOrganizerView } from '@/lib/view-tracker';
import { loadSignupForOrganizer } from '@/services/signups.cached';
import { signupMetadata } from '../signup-metadata';

type PageProps = { params: Promise<{ id: string }> };

export const generateMetadata = signupMetadata;

/**
 * Where Publish lands: "It's live. Now send the link." The link with Copy
 * link and the phone's own share sheet, a message to send with it, and a QR
 * code to download. Only an open signup has a link worth sending, so a draft
 * goes back to be checked and anything else to its builder.
 */
export default async function ShareSignupPage({ params }: PageProps) {
  const { id } = await params;
  // Outside the tabs' layout, so it checks the session itself.
  const session = await requireOrganizerSession();
  const result = await loadSignupForOrganizer(toActor(session), id);
  if (!result.ok) return <SignupLoadError message={result.error.message} />;
  const sig = result.value;
  // A draft goes to its own address, which picks the review page or the
  // builder; anything else has only the builder to go to.
  if (sig.status === 'draft') redirect(`/app/signups/${id}`);
  if (sig.status !== 'open') redirect(`/app/signups/${id}/build`);

  await trackOrganizerView({
    actor: { actorId: session.organizerId, actorType: 'organizer' },
    signupId: sig.id,
    workspaceId: sig.workspaceId,
    eventType: 'signup.editor_opened',
    payload: { section: 'share' },
  });

  const url = publicSignupUrl(sig.slug);
  return (
    <ShareStep
      signupId={id}
      title={sig.title}
      url={url}
      slug={sig.slug}
      doneHref={`/app/signups/${id}/build`}
    />
  );
}
