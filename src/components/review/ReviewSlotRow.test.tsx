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

/** A row's contents as the review card draws them, and the group it's in. */
function RowContents({ title, people, group }: { title: string; people: string; group?: string }) {
  return (
    <>
      <span>{title}</span>
      <span>
        <span className="sr-only">, </span>
        {people}
      </span>
      {group ? <span className="sr-only">, {group}</span> : null}
    </>
  );
}

function renderList(extraFields: BuildField[] = []) {
  return render(
    <ReviewSlotEditing
      signupId="sig_1"
      fields={[...FIELDS, ...extraFields]}
      id="slots"
      className=""
      allDrawn
    >
      <ul>
        <ReviewSlotRow slot={SLOTS[0]!}>
          <RowContents title="Fruit and water" people="2 people" />
        </ReviewSlotRow>
        <ReviewSlotRow slot={SLOTS[1]!}>
          <RowContents title="Napkins" people="1 person" />
        </ReviewSlotRow>
      </ul>
    </ReviewSlotEditing>,
  );
}

const rowButton = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^Edit slot — ${name}`) });

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
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
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
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
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
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('names each row "Edit slot — " and what it shows, with its group', () => {
    render(
      <ReviewSlotEditing signupId="sig_1" fields={FIELDS} id="slots" className="" allDrawn>
        <ul>
          <ReviewSlotRow slot={SLOTS[0]!}>
            <RowContents title="Fruit and water" people="2 people" group="Sat, Apr 6" />
          </ReviewSlotRow>
        </ul>
      </ReviewSlotEditing>,
    );
    // The row's parts sit on lines of their own, so a space may come before
    // each comma, as here.
    expect(
      screen.getByRole('button', {
        name: /^Edit slot — Fruit and water ?, 2 people ?, Sat, Apr 6$/,
      }),
    ).toBeInTheDocument();
  });

  /** Adds "Drinks" to the Kind list from the open slot's picker. */
  async function addDrinks() {
    fireEvent.click(screen.getByRole('button', { name: 'Kind value' }));
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    fireEvent.change(screen.getByLabelText('New option name'), { target: { value: 'Drinks' } });
    fireEvent.keyDown(screen.getByLabelText('New option name'), { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Kind value' })).toHaveTextContent('Drinks'),
    );
  }

  it('saves a new list choice on Done, with only its config, before the slot', async () => {
    fetchMock.mockResolvedValue(ok());
    renderList([KIND]);
    await open('Fruit and water');
    await addDrinks();
    // Nothing is saved until Done, the new choice included.
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
    expect(sent()).toEqual([
      {
        url: '/api/signups/sig_1/fields/fld_kind',
        body: { config: { fieldType: 'enum', choices: ['Food', 'Drinks'] } },
      },
      {
        url: '/api/slots/slot_1',
        body: { values: { what: 'Fruit and water', qty: 6, kind: 'Drinks' } },
      },
    ]);
  });

  it('drops a new list choice on Cancel', async () => {
    renderList([KIND]);
    await open('Fruit and water');
    await addDrinks();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    await open('Fruit and water');
    fireEvent.click(screen.getByRole('button', { name: 'Kind value' }));
    expect(screen.queryByRole('option', { name: 'Drinks' })).toBeNull();
  });

  it('keeps the editor open and saves no slot when the new choice is refused', async () => {
    fetchMock.mockResolvedValue(refused('invalid_input'));
    renderList([KIND]);
    await open('Fruit and water');
    await addDrinks();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Some values weren’t accepted.');
    expect(sent().map((r) => r.url)).toEqual(['/api/signups/sig_1/fields/fld_kind']);
    expect(screen.getByRole('button', { name: 'Kind value' })).toHaveTextContent('Drinks');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('refreshes the page when the new choice saved but the slot was refused', async () => {
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(refused('conflict'));
    renderList([KIND]);
    await open('Fruit and water');
    await addDrinks();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload to see the latest changes.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('What value')).toBeInTheDocument();
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

  /** The list as the page draws it, with only these of its slots' rows. */
  function List({ rows, allDrawn }: { rows: (0 | 1)[]; allDrawn: boolean }) {
    const titles = ['Fruit and water', 'Napkins'];
    return (
      <ReviewSlotEditing
        signupId="sig_1"
        fields={FIELDS}
        id="slots"
        className=""
        allDrawn={allDrawn}
      >
        <ul>
          {rows.map((i) => (
            <ReviewSlotRow key={i} slot={SLOTS[i]!}>
              <RowContents title={titles[i]!} people="1 person" />
            </ReviewSlotRow>
          ))}
        </ul>
      </ReviewSlotEditing>
    );
  }

  it('closes a slot gone from the page that came back, deleted in another tab say', async () => {
    const { rerender } = render(<List rows={[0, 1]} allDrawn />);
    await open('Fruit and water');
    // Every slot has its row, and it has none: the slot is gone.
    rerender(<List rows={[1]} allDrawn />);
    expect(screen.queryByLabelText('What value')).toBeNull();
    // A row of that id again stays closed: it isn't opened on its own.
    rerender(<List rows={[0, 1]} allDrawn />);
    expect(rowButton('Fruit and water')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('What value')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a slot open that is only folded away, past the first rows', async () => {
    const { rerender } = render(<List rows={[0, 1]} allDrawn />);
    await open('Fruit and water');
    // Pushed past the fold: its row isn't drawn, but the slot is still there.
    rerender(<List rows={[1]} allDrawn={false} />);
    expect(screen.queryByLabelText('What value')).toBeNull();
    rerender(<List rows={[0, 1]} allDrawn />);
    expect(rowButton('Fruit and water')).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByLabelText('What value')).toBeInTheDocument();
  });

  // A save can move the slot to another group, as a new date does when the
  // list is grouped by date. Its row is then a new one, under a group that
  // may be folded.
  describe('when the save moves the slot to another group', () => {
    function Grouped({ group }: { group: string }) {
      return (
        <ReviewSlotEditing signupId="sig_1" fields={FIELDS} id="slots" className="" allDrawn>
          <details key={group} open={group === 'Sat, Apr 6'}>
            <summary>{group}</summary>
            <ul>
              <ReviewSlotRow slot={SLOTS[0]!}>
                <RowContents title="Fruit and water" people="2 people" group={group} />
              </ReviewSlotRow>
            </ul>
          </details>
          <ul>
            <ReviewSlotRow slot={SLOTS[1]!}>
              <RowContents title="Napkins" people="1 person" />
            </ReviewSlotRow>
          </ul>
        </ReviewSlotEditing>
      );
    }

    /** Draws the list, and moves the first slot to a folded group on refresh. */
    function renderGrouped() {
      const { rerender } = render(<Grouped group="Sat, Apr 6" />);
      router.refresh.mockImplementation(() => rerender(<Grouped group="Sat, Apr 13" />));
    }

    it('closes it, says Saved, and gives focus back to its row, opening its group', async () => {
      fetchMock.mockResolvedValue(ok());
      renderGrouped();
      await open('Fruit and water');
      fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '4' } });
      fireEvent.click(screen.getByRole('button', { name: /Done/ }));

      await waitFor(() => expect(screen.queryByLabelText('What value')).toBeNull());
      const row = rowButton('Fruit and water');
      expect(row).toHaveAccessibleName(/Sat, Apr 13$/);
      expect(row).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('status')).toHaveTextContent('Saved');
      await waitFor(() => expect(row).toHaveFocus());
      expect(row.closest('details')).toHaveAttribute('open');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('opens the slot chosen meanwhile', async () => {
      fetchMock.mockResolvedValue(ok());
      renderGrouped();
      await open('Fruit and water');
      fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '4' } });
      fireEvent.click(rowButton('Napkins'));

      await waitFor(() => expect(screen.getByLabelText('What value')).toHaveValue('Napkins'));
      expect(rowButton('Napkins')).toHaveAttribute('aria-expanded', 'true');
      expect(rowButton('Fruit and water')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getAllByLabelText('What value')).toHaveLength(1);
    });
  });
});
