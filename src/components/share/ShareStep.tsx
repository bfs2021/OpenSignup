'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Share } from 'lucide-react';
import { useClipboardCopy } from '@/hooks/useClipboardCopy';
import { withLink } from '@/lib/share-message';
import { emitSignupLinkEvent } from '@/lib/signup-link-events';
import { ShareQrCode } from './ShareQrCode';

const BUTTON_CLASS =
  'inline-flex h-12 items-center justify-center gap-2 rounded-lg px-3 text-[15px] font-semibold transition';

/**
 * What an organizer sees right after publishing: the link, ways to send it
 * (copy, the phone's share sheet, a message, a QR code), then back to the
 * signup. Each copy or share is recorded once it has worked: after the
 * clipboard took it, or the share sheet closed having sent it.
 */
export function ShareStep({
  signupId,
  title,
  url,
  slug,
  message: initialMessage,
  doneHref,
}: {
  signupId: string;
  title: string;
  url: string;
  slug: string;
  /** The message to start from, in `shareMessage`'s fixed words. */
  message: string;
  doneHref: string;
}) {
  const link = useClipboardCopy();
  const messageCopy = useClipboardCopy();
  const [message, setMessage] = useState(initialMessage);
  const [canShare, setCanShare] = useState(false);
  const messageId = useId();

  useEffect(() => {
    // Only after mount, so the server's HTML and the first render agree.
    setCanShare('share' in navigator);
  }, []);

  async function copyLink() {
    if (await link.copy(url)) emitSignupLinkEvent(signupId, 'copied', 'share_step');
  }

  async function share() {
    try {
      await navigator.share({ title, url });
    } catch {
      // Closing the sheet without sending rejects with AbortError, and a
      // refused share rejects too. Neither sent the link.
      return;
    }
    emitSignupLinkEvent(signupId, 'shared', 'share_step');
  }

  async function copyMessage() {
    if (await messageCopy.copy(withLink(message, url))) {
      emitSignupLinkEvent(signupId, 'copied', 'share_message');
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6 pb-10">
      <div className="flex flex-col gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success"
        >
          <Check size={26} strokeWidth={3} />
        </span>
        <h1 className="text-balance text-[28px] font-bold leading-tight tracking-tight sm:text-3xl">
          It&apos;s live. Now send the link.
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          <span className="break-words font-semibold text-ink">{title}</span>
          {/[.!?…]$/.test(title) ? '' : '.'} People sign up from this link, with no account.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="select-all break-all rounded-lg border border-surface-sunk bg-surface-raised px-4 py-3 font-mono text-sm text-ink">
          {url}
        </p>
        <div className={`grid gap-2.5 ${canShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button
            type="button"
            onClick={copyLink}
            className={`${BUTTON_CLASS} bg-brand text-white hover:brightness-110`}
          >
            {link.copied ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <Copy size={18} aria-hidden="true" />
            )}
            {link.copied ? 'Copied' : 'Copy link'}
          </button>
          {canShare ? (
            <button
              type="button"
              onClick={share}
              className={`${BUTTON_CLASS} border border-surface-sunk bg-white text-ink hover:bg-surface-raised`}
            >
              <Share size={18} aria-hidden="true" />
              Share…
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={messageId} className="text-[13px] font-semibold text-ink">
          A message to send with it
        </label>
        <textarea
          id={messageId}
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-lg border border-surface-sunk bg-white px-3 py-2.5 text-base leading-relaxed text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <button
          type="button"
          onClick={copyMessage}
          className="inline-flex items-center gap-1.5 self-start py-1.5 text-sm font-semibold text-brand hover:underline"
        >
          {messageCopy.copied ? <Check size={16} aria-hidden="true" /> : null}
          {messageCopy.copied ? 'Message copied' : 'Copy message and link'}
        </button>
      </div>

      <ShareQrCode url={url} fileName={`${slug}-qr.png`} />

      <Link
        href={doneHref}
        className={`${BUTTON_CLASS} w-full border border-surface-sunk bg-white text-ink hover:bg-surface-raised`}
      >
        Done, go to my signup
      </Link>

      <span className="sr-only" aria-live="polite">
        {link.copied ? 'Link copied' : messageCopy.copied ? 'Message and link copied' : ''}
      </span>
    </div>
  );
}
