'use client';

import { useEffect, useState } from 'react';
import { Banner } from '@/components/banner';
import { useDismissibleQueryFlag } from '@/hooks/useDismissibleQueryFlag';
import { AiDraftWarningList } from '@/components/review/AiDraftWarnings';
import { clearAiDraftWarnings, readAiDraftWarnings } from './ai-draft-warnings';

export function AiDraftBanner({
  signupId,
  signupStatus,
  fieldsCount,
  slotsCount,
}: {
  signupId: string;
  signupStatus: string;
  fieldsCount: number;
  slotsCount: number;
}) {
  const [shown, dismiss] = useDismissibleQueryFlag('aiDraft');
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (signupStatus !== 'draft') {
      clearAiDraftWarnings(signupId);
      return;
    }
    if (!shown) return;
    setWarnings(readAiDraftWarnings(signupId));
  }, [shown, signupId, signupStatus]);

  if (signupStatus !== 'draft' || !shown) return null;

  const onDismiss = () => {
    clearAiDraftWarnings(signupId);
    dismiss();
  };

  return (
    <div className="flex flex-col gap-3">
      <Banner
        kind="aiDraft"
        title={`Here's your draft, ${fieldsCount} ${
          fieldsCount === 1 ? 'column' : 'columns'
        } and ${slotsCount} ${slotsCount === 1 ? 'slot' : 'slots'}`}
        body="Edit anything below, then publish when you're ready."
        onDismiss={onDismiss}
      />
      <AiDraftWarningList warnings={warnings} />
    </div>
  );
}
