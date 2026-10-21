import type { ReactNode } from 'react';

/**
 * The card an email's unsubscribe link opens on: a participant's reminders
 * (`/s/[slug]/unsubscribe`) and an organizer's draft email
 * (`/unsubscribe/drafts`). An incomplete or invalid link shows
 * `SignupStateMessage` instead.
 */
export function UnsubscribeCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="container-tight flex min-h-[100svh] flex-col justify-center gap-4 py-8">
      <div className="space-y-4 rounded-xl border border-surface-sunk bg-white p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
