'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import type { Bitmap2D } from 'lean-qr/nano';
import { QR_QUIET_ZONE, qrPngScale, qrSide, qrSvgPath } from '@/lib/qr';

/** The downloaded picture is at least this many pixels wide, enough for print. */
const PNG_MIN_PX = 1024;

type QrState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; code: Bitmap2D; side: number; path: string };

/**
 * The code, margin included, black on white, as a PNG data URL; null where
 * the browser can't draw one. The encoder paints one pixel per module, which
 * is then scaled up with no smoothing so the edges stay sharp.
 */
function toPngDataUrl(code: Bitmap2D): string | null {
  const small = document.createElement('canvas');
  code.toCanvas(small, { pad: QR_QUIET_ZONE, on: [0, 0, 0, 255], off: [255, 255, 255, 255] });
  const big = document.createElement('canvas');
  big.width = big.height = qrSide(code) * qrPngScale(code, PNG_MIN_PX);
  const ctx = big.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, big.width, big.height);
  return big.toDataURL('image/png');
}

/**
 * The share step's QR code row: a small preview and a link that saves it as
 * a PNG, for a flyer or a newsletter. The browser draws both itself, so the
 * link goes to no outside service. The encoder loads only once this mounts,
 * which keeps it out of the page's first load, and the PNG is drawn only
 * when the link is chosen.
 */
export function ShareQrCode({ url, fileName }: { url: string; fileName: string }) {
  const [qr, setQr] = useState<QrState>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    import('lean-qr/nano')
      .then(({ generate, correction }) => {
        if (!live) return;
        const code = generate(url, { minCorrectionLevel: correction.M });
        setQr({ kind: 'ready', code, side: qrSide(code), path: qrSvgPath(code) });
      })
      .catch(() => {
        // Without a code the rest of the step still works: leave the row out.
        if (live) setQr({ kind: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [url]);

  if (qr.kind === 'failed') return null;

  function download(e: MouseEvent<HTMLAnchorElement>) {
    if (qr.kind !== 'ready') return;
    // Set before the browser follows the link, which it does after this
    // handler returns, so the click that asked for it saves it.
    const png = toPngDataUrl(qr.code);
    if (png) e.currentTarget.href = png;
    else e.preventDefault();
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-surface-sunk bg-white p-3">
      {qr.kind === 'ready' ? (
        <svg
          viewBox={`0 0 ${qr.side} ${qr.side}`}
          width={64}
          height={64}
          role="img"
          aria-label="QR code for the link"
          shapeRendering="crispEdges"
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
        {qr.kind === 'ready' ? (
          <a
            href="#"
            download={fileName}
            onClick={download}
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
