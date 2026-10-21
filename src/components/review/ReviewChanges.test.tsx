// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BuildField } from '@/components/build-shared/useBuildState';
import type { NoticeView } from '@/lib/draft-notices';
import type { DraftFixUndo, RemoveDayRequest } from '@/schemas/draft-fixes';
import { NoticeFixes } from './NoticeFixes';
import { RemoveDayButton, ReviewChanges } from './ReviewChanges';
import { ReviewSlotEditing, ReviewSlotRow } from './ReviewSlotRow';

const actions = vi.hoisted(() => ({
  applyDraftFixAction: vi.fn(),
  removeDayAction: vi.fn(),
  undoDraftFixAction: vi.fn(),
}));
vi.mock('@/app/app/(chrome)/signups/[id]/actions', () => actions);

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const fetchMock = vi.fn<typeof fetch>();

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
  fingerprint: '2.abcdefghijklmnop',
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

const FIELDS: BuildField[] = [
  {
    id: 'fld_what',
    ref: 'what',
    name: 'What',
    config: { fieldType: 'text', maxLength: 200 },
    sortOrder: 0,
  },
];

/**
 * The slots card's changes, as the page draws them: the notices, then the
 * slot list with a day's Remove day and a slot, or, with `day: false`, the
 * list after that day has gone.
 */
function Card({ day = true }: { day?: boolean }) {
  return (
    <ReviewChanges signupId="sig_1">
      <NoticeFixes
        signupId="sig_1"
        heading="1 thing to fix before you publish"
        notices={[BLANK]}
        builderHref="/app/signups/sig_1/build"
        labelMaxLength={80}
      />
      <ReviewSlotEditing signupId="sig_1" fields={FIELDS} id="slots" className="" allDrawn>
        {day ? (
          <RemoveDayButton signupId="sig_1" request={DAY} name="Remove day: Sat, Apr 6" />
        ) : null}
        <ul>
          <ReviewSlotRow slot={{ id: 'slot_1', values: { what: 'Napkins' }, capacity: 1 }}>
            Napkins
          </ReviewSlotRow>
        </ul>
      </ReviewSlotEditing>
    </ReviewChanges>
  );
}

function renderCard() {
  return render(<Card />);
}

/** Opens the slot, changes its capacity, and leaves it open. */
async function editSlot() {
  fireEvent.click(screen.getByRole('button', { name: /^Edit slot — Napkins/ }));
  fireEvent.change(await screen.findByLabelText('Capacity'), { target: { value: '3' } });
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
  router.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<ReviewChanges />', () => {
  it('removes a day, says so, and puts focus on Undo', async () => {
    const answer = deferred<{ done: string; undo: DraftFixUndo }>();
    actions.removeDayAction.mockReturnValue(answer.promise);
    renderCard();
    expect(removeDay()).toHaveTextContent('Remove day');

    fireEvent.click(removeDay());
    await waitFor(() => expect(actions.removeDayAction).toHaveBeenCalledWith('sig_1', DAY));
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
    await waitFor(() =>
      expect(screen.getByText('Undone.').closest('[role="status"]')).toHaveFocus(),
    );
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

  it('says why a Remove day was refused by its button, with focus, and keeps the last Undo', async () => {
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
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'That changed since you opened this page, so nothing was done.',
    );
    // Under the button pressed, not at the top of the card.
    expect(removeDay().parentElement).toContainElement(alert);
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    expect(screen.getByText('Removed the empty slot.')).toBeInTheDocument();
    expect(undoButton()).toBeInTheDocument();
  });

  it('moves a Remove day refusal to the card’s line once its day is gone from the page', async () => {
    actions.removeDayAction.mockResolvedValue({
      error: 'That changed since you opened this page, so nothing was done.',
    });
    const { rerender } = renderCard();
    fireEvent.click(removeDay());
    await screen.findByRole('alert');
    // The page that came back no longer has the day.
    rerender(<Card day={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That changed since you opened this page, so nothing was done.',
    );
  });

  it('says why a fix was refused on the card’s line, not by Remove day', async () => {
    actions.applyDraftFixAction.mockResolvedValue({
      error: 'That changed since you opened this page, so nothing was done.',
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    const alert = await screen.findByRole('alert');
    expect(removeDay().parentElement).not.toContainElement(alert);
  });

  it('says so in words when no answer comes back', async () => {
    actions.removeDayAction.mockRejectedValue(new Error('offline'));
    renderCard();
    fireEvent.click(removeDay());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t remove that day. Try again.');
    expect(removeDay().parentElement).toContainElement(alert);
    expect(removeDay()).toBeEnabled();
  });

  it('saves an open, changed slot before Remove day, then removes the day', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    actions.removeDayAction.mockResolvedValue({
      done: 'Removed Sat, Apr 6 and its 2 slots.',
      undo: DAY_UNDO,
    });
    renderCard();
    await editSlot();

    fireEvent.click(removeDay());
    expect(await screen.findByText('Removed Sat, Apr 6 and its 2 slots.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/slots/slot_1');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ capacity: 3 });
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      actions.removeDayAction.mock.invocationCallOrder[0]!,
    );
    // Focus goes where the change sends it, not back to the slot's row.
    await waitFor(() => expect(undoButton()).toHaveFocus());
  });

  it('makes no change when the open slot’s save is refused, and leaves it open saying why', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'conflict', message: 'x' } }), { status: 409 }),
    );
    renderCard();
    await editSlot();

    fireEvent.click(removeDay());
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload to see the latest changes.');
    await waitFor(() => expect(removeDay()).toBeEnabled());
    expect(actions.removeDayAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Capacity')).toHaveValue(3);
  });

  it('saves an open, changed slot before Undo too', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    actions.applyDraftFixAction.mockResolvedValue({
      done: 'Removed the empty slot.',
      undo: BLANK_UNDO,
    });
    actions.undoDraftFixAction.mockResolvedValue(null);
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    await screen.findByText('Removed the empty slot.');
    await editSlot();

    fireEvent.click(undoButton()!);
    expect(await screen.findByText('Undone.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      actions.undoDraftFixAction.mock.invocationCallOrder[0]!,
    );
  });

  it('closes an open slot with nothing changed before a change, without a request', async () => {
    actions.applyDraftFixAction.mockResolvedValue({
      done: 'Removed the empty slot.',
      undo: BLANK_UNDO,
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /^Edit slot — Napkins/ }));
    await screen.findByLabelText('Capacity');

    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    await screen.findByText('Removed the empty slot.');
    expect(screen.queryByLabelText('Capacity')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(undoButton()).toHaveFocus());
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
