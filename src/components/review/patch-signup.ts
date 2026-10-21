import { SAVE_ERROR_MESSAGE } from '@/components/ui/save-notice';
import type { ErrorCode } from '@/lib/errors';

/**
 * Sends `body` to `url` as a PATCH. Returns null once saved, or what to tell
 * the organizer when it wasn't, in the words the Build and Settings tabs use.
 */
async function patch(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const envelope = (await res.json().catch(() => null)) as {
      error?: { code?: ErrorCode };
    } | null;
    return SAVE_ERROR_MESSAGE[envelope?.error?.code ?? 'internal'] ?? SAVE_ERROR_MESSAGE.internal;
  } catch {
    return SAVE_ERROR_MESSAGE.internal;
  }
}

/**
 * Saves part of a signup through `PATCH /api/signups/[id]`, which merges what
 * it's sent over the stored row.
 */
export function patchSignup(signupId: string, body: unknown): Promise<string | null> {
  return patch(`/api/signups/${encodeURIComponent(signupId)}`, body);
}

/**
 * Saves a slot through `PATCH /api/slots/[id]`, the route the builder saves
 * slots through. Its `values` replace the slot's whole; see `slotPatch`.
 */
export function patchSlot(slotId: string, body: unknown): Promise<string | null> {
  return patch(`/api/slots/${encodeURIComponent(slotId)}`, body);
}

/**
 * Saves a field through `PATCH /api/signups/[id]/fields/[fieldId]`, the
 * route the builder adds a list's choices through.
 */
export function patchField(
  signupId: string,
  fieldId: string,
  body: unknown,
): Promise<string | null> {
  return patch(
    `/api/signups/${encodeURIComponent(signupId)}/fields/${encodeURIComponent(fieldId)}`,
    body,
  );
}
