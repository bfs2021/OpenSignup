// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BuildField } from '@/components/build-shared/useBuildState';
import { ReviewSlotEditing, ReviewSlotRow } from './ReviewSlotRow';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const fetchMock = vi.fn<typeof fetch>();

const FIELDS: BuildField[] = [
  {
    id: 'fld_what',
    ref: 'what',
    name: 'What',
    config: { fieldType: 'text', maxLength: 200 },
    sortOrder: 0,
  },
  { id: 'fld_qty', ref: 'qty', name: 'Bottles', config: { fieldType: 'number' }, sortOrder: 1 },
];

const SLOTS = [
  { id: 'slot_1', values: { what: 'Fruit and water', qty: 6 }, capacity: 2 },
  { id: 'slot_2', values: { what: 'Napkins' }, capacity: 1 },
];

const KIND: BuildField = {
  id: 'fld_kind',
  ref: 'kind',
  name: 'Kind',
  config: { fieldType: 'enum', choices: ['Food'] },
  sortOrder: 2,
};

function renderList(extraFields: BuildField[] = []) {
  render(
    <ReviewSlotEditing signupId="sig_1" fields={[...FIELDS, ...extraFields]} slots={SLOTS}>
      <ul>
        <ReviewSlotRow slotId="slot_1" label="Edit slot — Fruit and water">
          <span>Fruit and water</span>
          <span>2 people</span>
        </ReviewSlotRow>
        <ReviewSlotRow slotId="slot_2" label="Edit slot — Napkins">
          <span>Napkins</span>
          <span>1 person</span>
        </ReviewSlotRow>
      </ul>
    </ReviewSlotEditing>,
  );
}

const rowButton = (name: string) => screen.getByRole('button', { name: `Edit slot — ${name}` });

/** Opens a slot and waits for its editor, which loads on first use. */
async function open(name: string) {
  fireEvent.click(rowButton(name));
  await screen.findByLabelText('What value');
}

function ok(): Response {
  return new Response(JSON.stringify({ data: {} }), { status: 200 });
}

function refused(code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: 'for developers' } }), {
    status: 409,
  });
}

/** The PATCH bodies sent, by URL. */
function sent(): Array<{ url: string; body: unknown }> {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String(init?.body)),
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  router.refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<ReviewSlotRow />', () => {
  it('opens the slot editor under the row and puts focus in its first box', async () => {
    renderList();
    expect(rowButton('Fruit and water')).toHaveAttribute('aria-expanded', 'false');
    await open('Fruit and water');
    expect(rowButton('Fruit and water')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('What value')).toHaveValue('Fruit and water');
    expect(screen.getByLabelText('Capacity')).toHaveValue(2);
    await waitFor(() => expect(screen.getByLabelText('What value')).toHaveFocus());
    // Slots are added and removed in the builder.
    expect(screen.queryByRole('button', { name: /Duplicate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('saves on Done in one request with only the capacity, then says Saved', async () => {
    fetchMock.mockResolvedValue(ok());
    renderList();
    await open('Fruit and water');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '4' } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));

    await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
    expect(sent()).toEqual([{ url: '/api/slots/slot_1', body: { capacity: 4 } }]);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(rowButton('Fruit and water')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Saved');
    await waitFor(() => expect(rowButton('Fruit and water')).toHaveFocus());
  });

  it('sends every value when one changed, numbers as numbers', async () => {
    fetchMock.mockResolvedValue(ok());
    renderList();
    await open('Fruit and water');
    fireEvent.change(screen.getByLabelText('What value'), { target: { value: 'Juice' } });
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sent()).toEqual([
      { url: '/api/slots/slot_1', body: { values: { what: 'Juice', qty: 6 } } },
    ]);
  });

  it('closes on Done without a request when nothing changed', async () => {
    renderList();
    await open('Fruit and water');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('throws the changes away on Cancel or Escape, and sends nothing', async () => {
    renderList();
    await open('Fruit and water');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
    await waitFor(() => expect(rowButton('Fruit and water')).toHaveFocus());

    await open('Fruit and water');
    // The change didn't stay behind in the editor.
    expect(screen.getByLabelText('Capacity')).toHaveValue(2);
    fireEvent.change(screen.getByLabelText('What value'), { target: { value: 'Juice' } });
    fireEvent.keyDown(screen.getByLabelText('What value'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the editor open and says why when the save is refused', async () => {
    fetchMock.mockResolvedValue(refused('conflict'));
    renderList();
    await open('Fruit and water');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload to see the latest changes.');
    expect(screen.getByLabelText('Capacity')).toHaveValue(1);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('adds a list choice through the field route before the slot takes it', async () => {
    fetchMock.mockResolvedValue(ok());
    renderList([KIND]);
    await open('Fruit and water');
    fireEvent.click(screen.getByRole('button', { name: 'Kind value' }));
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    fireEvent.change(screen.getByLabelText('New option name'), { target: { value: 'Drinks' } });
    fireEvent.keyDown(screen.getByLabelText('New option name'), { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Kind value' })).toHaveTextContent('Drinks'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([
      {
        url: '/api/signups/sig_1/fields/fld_kind',
        body: { fieldType: 'enum', config: { fieldType: 'enum', choices: ['Food', 'Drinks'] } },
      },
      {
        url: '/api/slots/slot_1',
        body: { values: { what: 'Fruit and water', qty: 6, kind: 'Drinks' } },
      },
    ]);
  });

  it('leaves the slot as it was when a new list choice is refused', async () => {
    fetchMock.mockResolvedValue(refused('forbidden'));
    renderList([KIND]);
    await open('Fruit and water');
    fireEvent.click(screen.getByRole('button', { name: 'Kind value' }));
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    fireEvent.change(screen.getByLabelText('New option name'), { target: { value: 'Drinks' } });
    fireEvent.keyDown(screen.getByLabelText('New option name'), { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('You don’t have edit access.');
    expect(screen.getByRole('button', { name: 'Kind value' })).not.toHaveTextContent('Drinks');
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('opens one slot at a time, saving the open one before the next opens', async () => {
    fetchMock.mockResolvedValue(ok());
    renderList();
    await open('Fruit and water');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '3' } });
    fireEvent.click(rowButton('Napkins'));

    await waitFor(() => expect(screen.getByLabelText('What value')).toHaveValue('Napkins'));
    expect(screen.getAllByLabelText('What value')).toHaveLength(1);
    expect(sent()).toEqual([{ url: '/api/slots/slot_1', body: { capacity: 3 } }]);
    expect(rowButton('Fruit and water')).toHaveAttribute('aria-expanded', 'false');
    expect(rowButton('Napkins')).toHaveAttribute('aria-expanded', 'true');
  });
});
