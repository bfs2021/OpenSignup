// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { shareMessage } from '@/lib/share-message';
import { ShareStep } from './ShareStep';

const emit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/signup-link-events', () => ({ emitSignupLinkEvent: emit }));
// The QR code needs a canvas, which jsdom lacks; the walkthrough covers it.
vi.mock('./ShareQrCode', () => ({ ShareQrCode: () => null }));

const LINK = 'https://your-site.example/s/snack-duty';
const writeText = vi.fn<(text: string) => Promise<void>>();

function renderStep() {
  render(
    <ShareStep
      signupId="sig_1"
      title="Snack duty"
      url={LINK}
      slug="snack-duty"
      message={shareMessage('Snack duty', LINK)}
      doneHref="/app/signups/sig_1/build"
    />,
  );
}

function giveShareSheet(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
}

beforeEach(() => {
  emit.mockClear();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
});

describe('<ShareStep />', () => {
  it('copies the link, then records a copy from the share step', async () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(emit).toHaveBeenCalledExactlyOnceWith('sig_1', 'copied', 'share_step');
  });

  it('records nothing when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
  });

  it('copies the message as edited, putting the link back if it was taken out', async () => {
    renderStep();
    const box = screen.getByLabelText('A message to send with it');
    expect(box).toHaveValue(`Snack duty\nSign up here: ${LINK}`);
    fireEvent.change(box, { target: { value: 'Snacks for Saturday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy message and link' }));
    await screen.findByRole('button', { name: 'Message copied' });
    expect(writeText).toHaveBeenCalledWith(`Snacks for Saturday\n${LINK}`);
    expect(emit).toHaveBeenCalledExactlyOnceWith('sig_1', 'copied', 'share_message');
  });

  it('offers Share… only where the browser has a share sheet', async () => {
    renderStep();
    expect(screen.queryByRole('button', { name: 'Share…' })).not.toBeInTheDocument();
    giveShareSheet(async () => {});
    renderStep();
    expect(await screen.findByRole('button', { name: 'Share…' })).toBeInTheDocument();
  });

  it('hands the sheet the link, and records a share once it was sent', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    giveShareSheet(share);
    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
    await waitFor(() => expect(emit).toHaveBeenCalledWith('sig_1', 'shared', 'share_step'));
    expect(share).toHaveBeenCalledWith({ title: 'Snack duty', url: LINK });
  });

  it('records nothing when the sheet is closed without sending', async () => {
    const share = vi.fn(async (_data: ShareData) => {
      throw new DOMException('Share canceled', 'AbortError');
    });
    giveShareSheet(share);
    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: 'Share…' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    await Promise.resolve();
    expect(emit).not.toHaveBeenCalled();
  });

  it('goes back to the builder when done', () => {
    renderStep();
    expect(screen.getByRole('link', { name: 'Done, go to my signup' })).toHaveAttribute(
      'href',
      '/app/signups/sig_1/build',
    );
  });
});
