'use client';

import { useEffect, useState } from 'react';
import { readAiDraftWarnings } from '@/components/magic-compose/ai-draft-warnings';

/**
 * What Magic Compose had to drop from the draft it just made (a date that
 * wasn't a date, a value outside its list), on the card that lists the slots
 * those values were for. The warnings live in this tab's sessionStorage,
 * written when the draft arrived; the Build tab's banner clears them once
 * the signup is published.
 */
export function AiDraftWarnings({ signupId }: { signupId: string }) {
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    setWarnings(readAiDraftWarnings(signupId));
  }, [signupId]);

  return <AiDraftWarningList warnings={warnings} />;
}

/** The list itself, shared with the Build tab's AI-draft banner. */
export function AiDraftWarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      className="border-warn/30 bg-warn/10 text-ink rounded-lg border px-5 py-4 text-sm"
    >
      <p className="mb-1 font-semibold">A few things to double-check</p>
      <ul className="list-inside list-disc space-y-1">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
