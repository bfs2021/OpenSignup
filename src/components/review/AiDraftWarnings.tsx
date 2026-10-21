'use client';

import { useEffect, useState } from 'react';
import { clearAiDraftWarnings, readAiDraftWarnings } from '@/components/magic-compose/ai-draft-warnings';
import { useDismissibleQueryFlag } from '@/hooks/useDismissibleQueryFlag';

/**
 * What Magic Compose had to drop from the draft it just made (a date that
 * wasn't a date, a value outside its list), on the card that lists the slots
 * those values were for. Shown where Magic Compose lands (`?aiDraft=1`), as
 * the Build tab's banner shows them; Dismiss forgets them.
 */
export function AiDraftWarnings({ signupId }: { signupId: string }) {
  const [shown, dismiss] = useDismissibleQueryFlag('aiDraft');
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (shown) setWarnings(readAiDraftWarnings(signupId));
  }, [shown, signupId]);

  if (!shown) return null;
  return (
    <AiDraftWarningList
      warnings={warnings}
      onDismiss={() => {
        clearAiDraftWarnings(signupId);
        dismiss();
      }}
    />
  );
}

/** The list itself, shared with the Build tab's AI-draft banner. */
export function AiDraftWarningList({
  warnings,
  onDismiss,
}: {
  warnings: string[];
  onDismiss?: () => void;
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      className="border-warn/30 bg-warn/10 text-ink flex items-start gap-3 rounded-lg border px-5 py-4 text-sm"
    >
      <div className="min-w-0 flex-1">
        <p className="mb-1 font-semibold">A few things to double-check</p>
        <ul className="list-inside list-disc space-y-1">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md px-2 py-1 text-[13px] font-medium text-ink-muted hover:bg-warn/10 hover:text-ink"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
