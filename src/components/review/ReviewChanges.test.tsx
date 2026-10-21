// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NoticeView } from '@/lib/draft-notices';
import type { DraftFixUndo, RemoveDayRequest } from '@/schemas/draft-fixes';
import { NoticeFixes } from './NoticeFixes';
import { RemoveDayButton, ReviewChanges } from './ReviewChanges';

const actions = vi.hoisted(() => ({
  applyDraftFixAction: vi.fn(),
  removeDayAction: vi.fn(),
  undoDraftFixAction: vi.fn(),
}));
vi.mock('@/app/app/(chrome)/signups/[id]/actions', () => actions);

const BLANK: NoticeView = {
  kind: 'blank_slot',
  key: 'blank_slot:c',
  text: 'One slot has nothing filled in.',
  fix: {
    type: 'button',
    label: 'Remove it',
    name: 'Remove it',
    request: { kind: 'blank_slot', slotIds: ['c'] },
  },
};

const DAY: RemoveDayRequest = {
  kind: 'remove_day',
  ref: 'date',
  value: '2030-04-06',
  slotIds: ['a', 'b'],
};

const DAY_UNDO: DraftFixUndo = {
  kind: 'remove_day',
  ref: 'date',
  value: '2030-04-06',
  slots: [{ values: { date: '2030-04-06' }, capacity: 1, sortOrder: 0, closed: false }],
};

const BLANK_UNDO: DraftFixUndo = {
  kind: 'blank_slot',
  slots: [{ values: {}, capacity: 1, sortOrder: 2, closed: false }],
};

/** The slots card's changes, as the page draws them: the notices, then a day. */
function renderCard() {
  return render(
    <ReviewChanges signupId="sig_1">
      <NoticeFixes
        signupId="sig_1"
        heading="1 thing to fix before you publish"
        notices={[BLANK]}
        builderHref="/app/signups/sig_1/build"
        labelMaxLength={80}
      />
      <RemoveDayButton signupId="sig_1" request={DAY} name="Remove day: Sat, Apr 6" />
    </ReviewChanges>,
  );
}

const removeDay = () => screen.getByRole('button', { name: 'Remove day: Sat, Apr 6' });
const undoButton = () => screen.queryByRole('button', { name: 'Undo' });

/** A promise this test settles when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
});

describe('<ReviewChanges />', () => {
  it('removes a day, says so, and puts focus on Undo', async () => {
    const answer = deferred<{ done: string; undo: DraftFixUndo }>();
    actions.removeDayAction.mockReturnValue(answer.promise);
    renderCard();
    expect(removeDay()).toHaveTextContent('Remove day');

    fireEvent.click(removeDay());
    expect(actions.removeDayAction).toHaveBeenCalledWith('sig_1', DAY);
    // Every change waits while one is in flight.
    await waitFor(() => expect(removeDay()).toBeDisabled());
    expect(removeDay()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Remove it' })).toBeDisabled();

    answer.resolve({ done: 'Removed Sat, Apr 6 and its 2 slots.', undo: DAY_UNDO });
    expect(await screen.findByText('Removed Sat, Apr 6 and its 2 slots.')).toBeInTheDocument();
    await waitFor(() => expect(undoButton()).toHaveFocus());
    expect(removeDay()).toBeEnabled();
  });

  it('undoes it through the same Undo as a fix, and puts focus on what it says', async () => {
    actions.removeDayAction.mockResolvedValue({
      done: 'Removed Sat, Apr 6 and its 2 slots.',
      undo: DAY_UNDO,
    });
    actions.undoDraftFixAction.mockResolvedValue(null);
    renderCard();
    fireEvent.click(removeDay());
    await waitFor(() => expect(undoButton()).toHaveFocus());

    fireEvent.click(undoButton()!);
    expect(await screen.findByText('Undone.')).toBeInTheDocument();
    expect(actions.undoDraftFixAction).toHaveBeenCalledWith('sig_1', DAY_UNDO);
    expect(undoButton()).toBeNull();
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
  });

  it('keeps one line: a fix after Remove day replaces its Undo, and the other way round', async () => {
    actions.removeDayAction.mockResolvedValue({
      done: 'Removed Sat, Apr 6 and its 2 slots.',
      undo: DAY_UNDO,
    });
    actions.applyDraftFixAction.mockResolvedValue({
      done: 'Removed the empty slot.',
      undo: BLANK_UNDO,
    });
    actions.undoDraftFixAction.mockResolvedValue(null);
    renderCard();

    fireEvent.click(removeDay());
    await screen.findByText('Removed Sat, Apr 6 and its 2 slots.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    expect(await screen.findByText('Removed the empty slot.')).toBeInTheDocument();
    expect(screen.queryByText('Removed Sat, Apr 6 and its 2 slots.')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);

    fireEvent.click(removeDay());
    expect(await screen.findByText('Removed Sat, Apr 6 and its 2 slots.')).toBeInTheDocument();
    expect(screen.queryByText('Removed the empty slot.')).toBeNull();
    fireEvent.click(undoButton()!);
    await screen.findByText('Undone.');
    // The last change's undo, and only it.
    expect(actions.undoDraftFixAction.mock.calls).toEqual([['sig_1', DAY_UNDO]]);
  });

  it('says why a Remove day was refused, and keeps the last change’s Undo', async () => {
    actions.applyDraftFixAction.mockResolvedValue({
      done: 'Removed the empty slot.',
      undo: BLANK_UNDO,
    });
    actions.removeDayAction.mockResolvedValue({
      error: 'That changed since you opened this page, so nothing was done.',
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    await screen.findByText('Removed the empty slot.');

    fireEvent.click(removeDay());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That changed since you opened this page, so nothing was done.',
    );
    expect(screen.getByText('Removed the empty slot.')).toBeInTheDocument();
    expect(undoButton()).toBeInTheDocument();
  });

  it('says so in words when no answer comes back', async () => {
    actions.removeDayAction.mockRejectedValue(new Error('offline'));
    renderCard();
    fireEvent.click(removeDay());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t remove that day. Try again.',
    );
    expect(removeDay()).toBeEnabled();
  });

  it('keeps what Remove day did said, without Undo, when the undo is refused', async () => {
    actions.removeDayAction.mockResolvedValue({
      done: 'Removed Sat, Apr 6 and its 2 slots.',
      undo: DAY_UNDO,
    });
    actions.undoDraftFixAction.mockResolvedValue({
      error: 'That changed again since, so it can’t be undone.',
    });
    renderCard();
    fireEvent.click(removeDay());
    await waitFor(() => expect(undoButton()).toHaveFocus());
    fireEvent.click(undoButton()!);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That changed again since, so it can’t be undone.',
    );
    expect(screen.getByText('Removed Sat, Apr 6 and its 2 slots.')).toBeInTheDocument();
    expect(undoButton()).toBeNull();
  });
});
