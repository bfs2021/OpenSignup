'use client';

import { useEffect, useState } from 'react';
import { clearAiDraftWarnings, readAiDraftWarnings } from '@/components/magic-compose/ai-draft-warnings';
import { AiDraftWarningList } from '@/components/magic-compose/AiDraftWarningList';
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
      action={
        <button
          type="button"
          onClick={() => {
            clearAiDraftWarnings(signupId);
            dismiss();
          }}
          className="shrink-0 rounded-md px-2 py-1 text-[13px] font-medium text-ink-muted hover:bg-warn/10 hover:text-ink"
        >
          Dismiss
        </button>
      }
    />
  );
}
