import { SAVE_ERROR_MESSAGE } from '@/components/ui/save-notice';
import type { ErrorCode } from '@/lib/errors';

/**
 * Saves part of a signup through `PATCH /api/signups/[id]`, which merges what
 * it's sent over the stored row. Returns null once saved, or what to tell the
 * organizer when it wasn't, in the words the Build and Settings tabs use.
 */
export async function patchSignup(signupId: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(`/api/signups/${encodeURIComponent(signupId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const envelope = (await res.json().catch(() => null)) as { error?: { code?: ErrorCode } } | null;
    return SAVE_ERROR_MESSAGE[envelope?.error?.code ?? 'internal'] ?? SAVE_ERROR_MESSAGE.internal;
  } catch {
    return SAVE_ERROR_MESSAGE.internal;
  }
}
