import type { ReactNode } from 'react';

/**
 * What Magic Compose had to drop from a draft, as a list. The Build tab's
 * banner and the review page's slots card both show it; `action` is the
 * review page's Dismiss.
 */
export function AiDraftWarningList({
  warnings,
  action,
}: {
  warnings: string[];
  action?: ReactNode;
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
      {action}
    </div>
  );
}
