import Link from 'next/link';
import type { NoticeText } from '@/lib/draft-notices';
import { noticeHeading } from '@/lib/draft-notices';

/**
 * The problems `checkDraft` found on a draft, each said in plain words, with
 * the builder to fix them in. Nothing found says so: the list below is what
 * people will see.
 */
export function ReviewNotices({
  notices,
  builderHref,
}: {
  notices: NoticeText[];
  builderHref: string;
}) {
  if (notices.length === 0) {
    // Not under Magic Compose's own warnings, which the card shows just above.
    return (
      <p className="text-[13px] text-success group-has-[[data-ai-warnings]]/card:hidden">
        Nothing to fix. This is the list people will see.
      </p>
    );
  }
  return (
    <section aria-labelledby="review-notices" className="flex flex-col gap-2">
      <h3 id="review-notices" className="text-[13px] font-semibold text-warn">
        {noticeHeading(notices.length)}
      </h3>
      <ul className="flex flex-col gap-2">
        {notices.map((notice, i) => (
          <li
            key={`${notice.kind}-${i}`}
            className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2.5 rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-3"
          >
            <p className="min-w-0 flex-[1_1_260px] text-[13.5px] leading-normal">{notice.text}</p>
            <Link
              href={builderHref}
              className="inline-flex h-9 shrink-0 items-center rounded-lg border border-brand/30 bg-white px-3.5 text-[13px] font-semibold text-brand transition hover:bg-brand-soft/40"
            >
              Fix in the builder
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
