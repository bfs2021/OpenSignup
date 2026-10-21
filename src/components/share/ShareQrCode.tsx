'use client';

import { useEffect, useState } from 'react';
import { paintQr, qrPngScale, qrSide, qrSvgPath, type QrModules } from '@/lib/qr';

/** The downloaded picture is at least this many pixels wide, enough for print. */
const PNG_MIN_PX = 1024;

type QrState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; side: number; path: string; pngHref: string | null };

/** The code, margin included, as a PNG; null where the browser can't draw one. */
function toPng(code: QrModules): Promise<Blob | null> {
  const scale = qrPngScale(code, PNG_MIN_PX);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = qrSide(code) * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  paintQr(ctx, code, scale);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * The share step's QR code row: a small preview and a link that saves it as
 * a PNG, for a flyer or a newsletter. The browser draws both itself, so the
 * link goes to no outside service. The encoder loads only once this mounts,
 * which keeps it out of the page's first load.
 */
export function ShareQrCode({ url, fileName }: { url: string; fileName: string }) {
  const [qr, setQr] = useState<QrState>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    let pngHref: string | null = null;
    (async () => {
      const { generate, correction } = await import('lean-qr/nano');
      if (!live) return;
      const code = generate(url, { minCorrectionLevel: correction.M });
      const ready = { kind: 'ready', side: qrSide(code), path: qrSvgPath(code) } as const;
      setQr({ ...ready, pngHref: null });
      const png = await toPng(code);
      if (!live) return;
      if (!png) throw new Error('no canvas');
      pngHref = URL.createObjectURL(png);
      setQr({ ...ready, pngHref });
    })().catch(() => {
      // Without a code the rest of the step still works: leave the row out.
      if (live) setQr({ kind: 'failed' });
    });
    return () => {
      live = false;
      if (pngHref) URL.revokeObjectURL(pngHref);
    };
  }, [url]);

  if (qr.kind === 'failed') return null;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-surface-sunk bg-white p-3">
      {qr.kind === 'ready' ? (
        <svg
          viewBox={`0 0 ${qr.side} ${qr.side}`}
          width={64}
          height={64}
          role="img"
          aria-label="QR code for the link"
          className="shrink-0"
        >
          <rect width={qr.side} height={qr.side} fill="#ffffff" />
          <path d={qr.path} fill="#000000" />
        </svg>
      ) : (
        <span aria-hidden="true" className="h-16 w-16 shrink-0 rounded-md bg-surface-sunk" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[15px] font-semibold text-ink">For a flyer or newsletter</p>
        {qr.kind === 'ready' && qr.pngHref ? (
          <a
            href={qr.pngHref}
            download={fileName}
            className="self-start py-1 text-sm font-semibold text-brand hover:underline"
          >
            Download QR code
          </a>
        ) : (
          <span aria-hidden="true" className="py-1 text-sm font-semibold text-ink-soft">
            Download QR code
          </span>
        )}
      </div>
    </div>
  );
}
