// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TabsNav } from './TabsNav';

// Where the organizer is: another tab until a test says otherwise.
const nav = vi.hoisted(() => ({ pathname: '/app/signups/sig_1/responses' }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => nav.pathname }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

describe('TabsNav scroll', () => {
  it('scrolls the tab strip itself, not the page, to center the active tab (#644)', () => {
    const { container, rerender } = render(
      <TabsNav signupId="sig_1" counts={{ build: 1, responses: 2 }} />,
    );
    const tablist = container.querySelector<HTMLElement>('[role="tablist"]')!;
    Object.defineProperty(tablist, 'clientWidth', { value: 300, configurable: true });
    // Same geometry on every tab: whichever is active after the switch gets
    // centered at 340 - (300 - 100) / 2 = 240.
    for (const tab of tablist.querySelectorAll<HTMLElement>('[role="tab"]')) {
      Object.defineProperty(tab, 'offsetLeft', { value: 340, configurable: true });
      Object.defineProperty(tab, 'offsetWidth', { value: 100, configurable: true });
    }

    // The mount effect already ran before layout existed; switching tabs runs
    // the effect again, the way a real click does.
    nav.pathname = '/app/signups/sig_1/build';
    rerender(<TabsNav signupId="sig_1" counts={{ build: 1, responses: 2 }} />);
    // 340 - (300 - 100) / 2 = 240: centered. jsdom accepts scrollLeft writes,
    // so this proves the strip (not the page) got scrolled by the centered amount.
    expect(tablist.scrollLeft).toBe(240);
  });

  it('never calls scrollIntoView, which moves Chrome\u2019s next-Tab start point', () => {
    // jsdom leaves scrollIntoView out; give it a spy so a regression to it is
    // observable.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<TabsNav signupId="sig_1" counts={{ build: 1, responses: 2 }} />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
