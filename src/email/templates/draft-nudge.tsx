import { Link, Section, Text } from '@react-email/components';
import { draftNudgeSubject } from '../subjects';
import { EmailButton, EmailHeading, EmailIntro, EmailLayout } from './layout';

export interface DraftNudgeEmailProps {
  signupTitle: string;
  /** `signupHeadline()`, the review page's own words: "12 slots · 3 days · 3 people each". */
  headline: string;
  /** The draft's review page, "Check your signup, then share it". */
  reviewUrl: string;
  /** The draft's Build tab. */
  builderUrl: string;
  /** The confirm page that turns this email off, for every draft of the organizer's. */
  unsubscribeUrl: string;
  /**
   * True when the organizer asked for it with "Email me a link to finish
   * later", false for the one the worker sends a few hours after a draft is
   * started. Only the opening and the footer's first sentence change.
   */
  requested: boolean;
}

export function DraftNudgeEmail({
  signupTitle,
  headline,
  reviewUrl,
  builderUrl,
  unsubscribeUrl,
  requested,
}: DraftNudgeEmailProps) {
  return (
    <EmailLayout preview={draftNudgeSubject(signupTitle)}>
      <EmailHeading>Your signup is ready to publish</EmailHeading>
      <EmailIntro>
        {requested ? (
          <>
            Here&apos;s your link back to <strong>{signupTitle}</strong>.
          </>
        ) : (
          <>
            You started <strong>{signupTitle}</strong> a few hours ago.
          </>
        )}{' '}
        It&apos;s still a draft, so nobody can see it yet.
      </EmailIntro>
      <Section className="mt-4 rounded-lg bg-[#f7f8fa] px-4 py-3">
        <Text className="m-0 text-xs font-semibold text-[#5b6474]">So far</Text>
        <Text className="m-0 mt-1 text-base font-semibold text-[#0b1220]">{headline}</Text>
      </Section>
      <EmailButton href={reviewUrl}>Check it and publish</EmailButton>
      <Text className="mt-6 text-[#5b6474]">
        Want to change something first?{' '}
        {/*
          No full stop after this link, nor the one below. react-email renders
          a <Link> in plaintext as the label then the bare URL, so punctuation
          after it lands against the URL, and clients that link plaintext
          addresses take it into the link.
        */}
        <Link href={builderUrl} className="text-[#1f6feb] underline">
          Open it in the builder
        </Link>
      </Text>
      <Text className="mt-6 text-xs text-[#8a93a4]">
        {requested
          ? "You asked for this link on the signup's page."
          : 'We send this once per draft, a few hours after you start it.'}{' '}
        If you&apos;re signed out, you&apos;ll sign in first and land right back on this signup.
      </Text>
      <Text className="mt-4 text-xs text-[#8a93a4]">
        <Link href={unsubscribeUrl} className="text-[#8a93a4] underline">
          Stop emails about unpublished drafts
        </Link>
      </Text>
    </EmailLayout>
  );
}

export default DraftNudgeEmail;
