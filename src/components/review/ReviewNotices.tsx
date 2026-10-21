import type { NoticeView } from '@/lib/draft-notices';
import { noticeHeading } from '@/lib/draft-notices';
import { NoticeFixes } from './NoticeFixes';

/**
 * The problems `checkDraft` found on a draft, each said in plain words, with
 * its fix: one tap for the kinds that have one, the builder for the rest.
 * Nothing found says so: the list below is what people will see. The words
 * are worked out here, on the server, so none of the checks or their wording
 * reach the browser.
 */
export function ReviewNotices({
  signupId,
  notices,
  builderHref,
  labelMaxLength,
}: {
  signupId: string;
  notices: NoticeView[];
  builderHref: string;
  labelMaxLength: number;
}) {
  return (
    <NoticeFixes
      signupId={signupId}
      heading={noticeHeading(notices.length)}
      notices={notices}
      builderHref={builderHref}
      labelMaxLength={labelMaxLength}
    />
  );
}
