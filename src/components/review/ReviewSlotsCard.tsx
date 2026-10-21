import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import {
  buildMetaSegments,
  groupSlots,
  pickPrimaryField,
  titleFor,
} from '@/app/s/[slug]/slot-format';
import {
  foldPlan,
  groupByRef,
  peopleLabel,
  sharedValues,
  signupHeadline,
} from '@/lib/signup-summary';
import { capacityOffer, removableDays, removeDayRequest } from '@/lib/draft-fixes';
import type { NoticeView } from '@/lib/draft-notices';
import type { SlotFieldDefinition } from '@/schemas/slot-fields';
import { MAX_CAPACITY } from '@/schemas/slots';
import { toBuildFields } from '@/components/build-shared/buildFields';
import { AiDraftWarnings } from './AiDraftWarnings';
import { ReviewCard } from './ReviewCard';
import { PeopleForEachSlot, RemoveDayButton, ReviewChanges } from './ReviewChanges';
import { ReviewNotices } from './ReviewNotices';
import { ReviewSlotEditing, ReviewSlotRow } from './ReviewSlotRow';

interface ReviewSlot {
  id: string;
  values: Record<string, unknown>;
  capacity: number | null;
  status: string;
}

/**
 * The review page's "What people sign up for" card: a headline in fixed
 * words, the values every slot shares said once, and the slots exactly as the
 * public page lists them (its grouping, titles and values), folded to the
 * first group or six rows. Server-rendered: groups fold with <details>, and
 * "Show all" is a link that renders the page again with everything open.
 * Each row is a button that opens the builder's slot editor under it
 * (`ReviewSlotRow`), and on a page grouped by date each day has Remove day;
 * beside the headline, "People for each slot" gives every slot the same
 * number; anything bigger is done in the builder. The notices' fixes, Remove
 * day and "People for each slot" share one line for what the last of them
 * did, with Undo (`ReviewChanges`).
 */
export function ReviewSlotsCard({
  signupId,
  fields,
  slots,
  settings,
  showAll,
  builderHref,
  notices,
  labelMaxLength,
}: {
  signupId: string;
  fields: SlotFieldDefinition[];
  slots: ReviewSlot[];
  settings: unknown;
  showAll: boolean;
  builderHref: string;
  /** What `checkDraft` found, in words, over every slot, with their fixes. */
  notices: NoticeView[];
  /** The longest a field's name can be, for the box that names one. */
  labelMaxLength: number;
}) {
  const summary = { fields, slots, settings };
  const groupRef = groupByRef(settings);
  const groupField = groupRef ? (fields.find((f) => f.ref === groupRef) ?? null) : null;
  const primary = pickPrimaryField(fields, groupField?.ref ?? null);
  // The row title stays on every row, so it isn't said again above them.
  const shared = sharedValues(summary).filter((v) => v.ref !== primary?.ref);
  const omitRefs = new Set(shared.map((v) => v.ref));
  const groups = groupSlots(slots, groupField);
  const plan = foldPlan(
    groups.map((g) => ({ key: g.key, size: g.slots.length })),
    groupField !== null,
  );
  // Read out between the row's parts, which show on lines of their own.
  const pause = <span className="sr-only">, </span>;
  // By group key. None unless the page is grouped by a date field.
  const days = new Map(removableDays(summary).map((d) => [d.value, d]));
  const peopleEach = capacityOffer(slots);

  return (
    <ReviewCard
      heading="What people sign up for"
      headingId="review-slots"
      attention={notices.length > 0}
    >
      <ReviewChanges
        signupId={signupId}
        header={
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-base font-semibold">{signupHeadline(summary)}</p>
              {peopleEach ? (
                <PeopleForEachSlot
                  signupId={signupId}
                  fingerprint={peopleEach.fingerprint}
                  shared={peopleEach.shared}
                  max={MAX_CAPACITY}
                />
              ) : null}
            </div>
            {shared.length > 0 ? (
              <p className="text-sm text-ink-muted">
                Same on every slot: {shared.map((v) => v.text).join(' · ')}
              </p>
            ) : null}
            <AiDraftWarnings signupId={signupId} />
          </>
        }
      >
        <ReviewNotices
          signupId={signupId}
          notices={notices}
          builderHref={builderHref}
          labelMaxLength={labelMaxLength}
        />
        <ReviewSlotEditing
          signupId={signupId}
          fields={toBuildFields(fields)}
          id="slots"
          className="flex scroll-mt-4 flex-col gap-3.5 pt-1 outline-none"
          allDrawn={showAll || plan.hiddenCount === 0}
        >
          {groups.map((group, i) => {
            const fold = plan.groups[i];
            // A closed group holds all its rows, out of sight until it's
            // opened; an open one shows the rows the fold allows.
            const shown =
              showAll || !fold || !fold.open ? group.slots : group.slots.slice(0, fold.visible);
            const rows = (
              <ul className="flex flex-col gap-2">
                {shown.map((slot) => {
                  const meta = buildMetaSegments({
                    fields,
                    slot,
                    primaryRef: primary?.ref,
                    groupRef: groupField?.ref ?? null,
                    omitRefs,
                  });
                  return (
                    // Only the rows drawn here can be opened, so only their
                    // slots go to the page's script.
                    <ReviewSlotRow
                      key={slot.id}
                      slot={{ id: slot.id, values: slot.values, capacity: slot.capacity }}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="break-words text-sm font-semibold">
                          {titleFor(slot, primary)}
                        </span>
                        {meta.length > 0 ? (
                          <span className="break-words text-xs text-ink-muted">
                            {pause}
                            {meta.join(' · ')}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[13px] text-ink-muted">
                        {pause}
                        {slot.status === 'closed' ? 'Closed' : peopleLabel(slot.capacity)}
                      </span>
                      {/* The group header says it once; each row's name says
                          it too, so rows in different groups differ. */}
                      {groupField ? (
                        <span className="sr-only">
                          {', '}
                          {group.label}
                        </span>
                      ) : null}
                    </ReviewSlotRow>
                  );
                })}
              </ul>
            );
            if (!groupField) return <div key={group.key}>{rows}</div>;
            const count = group.slots.length;
            const day = days.get(group.key);
            return (
              <details key={group.key} open={showAll || fold?.open} className="group">
                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    size={14}
                    strokeWidth={2.4}
                    aria-hidden="true"
                    className="shrink-0 transition-transform group-open:rotate-90"
                  />
                  <span className="min-w-0 break-words">{group.label}</span>
                  <span className="shrink-0 font-normal text-ink-muted">
                    · {count === 1 ? '1 slot' : `${count} slots`}
                  </span>
                </summary>
                <div className="flex flex-col gap-2 pt-2">
                  {day ? (
                    <RemoveDayButton
                      signupId={signupId}
                      request={removeDayRequest(day)}
                      name={`Remove day: ${day.label}`}
                    />
                  ) : null}
                  {rows}
                </div>
              </details>
            );
          })}
          {!showAll && plan.hiddenCount > 0 ? (
            <Link
              href={`/app/signups/${signupId}?all=1#slots`}
              scroll={false}
              className="inline-flex h-9 items-center self-start rounded-lg border border-surface-sunk bg-white px-3.5 text-[13px] font-medium text-ink transition hover:bg-surface-raised"
            >
              Show all {plan.total} slots
            </Link>
          ) : null}
        </ReviewSlotEditing>
      </ReviewChanges>
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Need something else, like another field or a different grouping?{' '}
        <Link href={builderHref} className="font-medium text-brand hover:underline">
          Open the full builder
        </Link>
      </p>
    </ReviewCard>
  );
}
