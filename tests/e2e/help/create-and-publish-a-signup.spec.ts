/**
 * Walkthrough for the help article "Create and publish your first signup"
 * (src/help/articles/create-and-publish-a-signup.tsx). It follows the
 * article's steps by the same on-screen names, so a renamed or moved control
 * fails here and points at the article. With HELP_SCREENSHOTS=1
 * (`pnpm help:screenshots`) it also refreshes the article's pictures.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { UI } from '@/help/articles/create-and-publish-a-signup.ui';
import { loginAsSeededOrganizer } from '../helpers/auth';
import { createPublishedSignup } from '../helpers/signups';

const SLUG = 'create-and-publish-a-signup';
const CAPTURE = process.env.HELP_SCREENSHOTS === '1';
const SHOT_DIR = `public/help/${SLUG}`;

async function shot(page: Page, target: Locator, name: string): Promise<void> {
  if (!CAPTURE) return;
  // Fonts and the save indicator settle after the last action.
  await page.waitForTimeout(300);
  await target.screenshot({ path: `${SHOT_DIR}/${name}.png`, animations: 'disabled' });
}

test.describe('help: create and publish your first signup', () => {
  // Screenshots at 2x so text stays sharp; the article sizes them in CSS pixels.
  test.use({ deviceScaleFactor: 2 });

  test('the steps work as written', async ({ page, context, browser, isMobile }) => {
    test.skip(isMobile, 'the phone path is its own test below');
    await loginAsSeededOrganizer(context);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create the signup
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: UI.yourSignups })).toBeVisible();
    await page.getByRole('link', { name: UI.newSignup, exact: true }).click();
    // Sites with drafting switched on ask first; the article says to skip it.
    // Wait for either screen: isVisible() doesn't wait, and the page is still
    // loading right after the click.
    const compose = page.getByRole('heading', { name: UI.composeHeading });
    await expect(compose.or(page.getByLabel(UI.title))).toBeVisible();
    if (await compose.isVisible()) {
      await expect(page.getByRole('button', { name: UI.draftCompose })).toBeVisible();
      await page.getByRole('link', { name: UI.skipCompose }).click();
    }
    await page.getByLabel(UI.title).fill('Snack duty — Spring season');
    await expect(page.getByLabel(UI.description)).toBeVisible();
    await shot(page, page.locator('form', { has: page.getByLabel(UI.title) }), 'new-signup');
    await page.getByRole('button', { name: UI.createSignup }).click();
    await page.waitForURL(/\/build$/);
    await expect(page.getByText('draft', { exact: true }).locator('visible=true')).toBeVisible();
    // "Nobody else can see a draft": its link says it isn't ready yet.
    const draftLink = await page
      .getByRole('link', { name: 'Open public page' })
      .locator('visible=true')
      .getAttribute('href');
    const outsider = await browser.newPage();
    await outsider.goto(draftLink ?? '');
    await expect(outsider.getByText(/isn.t ready yet/)).toBeVisible();
    await outsider.close();

    // Add slots
    await page.getByText(UI.emptySlot, { exact: true }).click();
    // An open slot; only one is open at a time.
    const slotEditor = page.locator('[data-testid^="slot-editor-"]');
    await expect(slotEditor.getByText(UI.what, { exact: true })).toBeVisible();
    await expect(slotEditor.getByText(UI.date, { exact: true })).toBeVisible();
    await slotEditor.getByRole('textbox', { name: `${UI.what} value` }).fill('Fruit and water');
    await slotEditor.getByLabel(`${UI.date} value`).fill('2030-04-06');
    await slotEditor.getByRole('spinbutton', { name: UI.capacity }).fill('2');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await shot(page, slotEditor, 'slot');
    await slotEditor.getByRole('button', { name: UI.done }).click();
    await expect(page.getByRole('button', { name: /Fruit and water/ })).toBeVisible();

    await page.getByRole('button', { name: UI.addSlot }).click();
    await expect(page.getByRole('button', { name: /^Edit slot/ })).toHaveCount(2);
    // The article warns that a slot left empty reaches people as "Untitled slot".
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const [withEmpty] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('link', { name: UI.preview }).click(),
    ]);
    await expect(withEmpty.getByText(UI.untitledSlot)).toBeVisible();
    await withEmpty.close();

    await page.getByRole('button', { name: /Fruit and water/ }).click();
    await slotEditor.getByRole('button', { name: UI.duplicate }).click();
    await slotEditor.getByRole('button', { name: UI.done }).click();
    await expect(page.getByRole('button', { name: /^Edit slot/ })).toHaveCount(3);
    // "Then open the copy and change its date." The copy lands last.
    await page
      .getByRole('button', { name: /Fruit and water/ })
      .last()
      .click();
    // The builder saves 800 ms after the last change; wait for it before
    // leaving the page, as a person would, or the new date is lost.
    const copySaved = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/api/slots/'),
    );
    await slotEditor.getByLabel(`${UI.date} value`).fill('2030-04-13');
    await copySaved;
    await slotEditor.getByRole('button', { name: UI.done }).click();
    await page.getByText(UI.emptySlot, { exact: true }).click();
    await slotEditor.getByRole('button', { name: UI.delete }).click();
    await expect(page.getByRole('button', { name: /^Edit slot/ })).toHaveCount(2);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // Reminders: on for a new signup, switched off from the date field.
    await page.getByRole('button', { name: new RegExp(`^${UI.fields}`) }).click();
    // One dialog; its name changes to "Edit field" once a field is chosen.
    const fields = page.getByRole('dialog');
    await fields.getByRole('button', { name: UI.date, exact: true }).click();
    await expect(fields.getByRole('checkbox', { name: UI.reminderToggle })).toBeChecked();
    await expect(fields.getByRole('button', { name: UI.save })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fields).toBeHidden();

    // Come back to a draft: from Your signups it opens on the review page.
    await page.goto('/app');
    await page.getByRole('link', { name: /Snack duty — Spring season/ }).click();
    const review = page.getByRole('heading', { name: UI.reviewHeading });
    await expect(review).toBeVisible();
    await expect(page.getByText('2 slots · 2 days · 2 people each')).toBeVisible();
    const signUpCard = page.getByRole('listitem', { name: /What happens when someone signs up/i });
    await expect(signUpCard.getByRole('button', { name: new RegExp(`^${UI.change}`) })).toBeVisible();
    await expect(
      page
        .getByRole('listitem', { name: /Name and description/i })
        .getByRole('button', { name: new RegExp(`^${UI.change}`) }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: UI.publishFromReview })).toBeVisible();
    // Not pressed: it sends an email, and the article only names it.
    await expect(page.getByRole('button', { name: UI.emailMeLater })).toBeVisible();
    // The three cards, without the page's heading and buttons around them.
    await shot(page, page.locator('main ol'), 'check-your-signup');
    // Change opens the card's form, with Save; Cancel closes it.
    await signUpCard.getByRole('button', { name: new RegExp(`^${UI.change}`) }).click();
    await expect(signUpCard.getByRole('button', { name: UI.save })).toBeVisible();
    await signUpCard.getByRole('button', { name: UI.cancel }).click();
    await page.getByRole('link', { name: UI.editInBuilder }).click();
    await page.waitForURL(/\/build$/);

    // Publish and share the link
    const [preview] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('link', { name: UI.preview }).click(),
    ]);
    await expect(
      preview.getByRole('heading', { name: 'Snack duty — Spring season' }),
    ).toBeVisible();
    await expect(preview.getByText(UI.untitledSlot)).toHaveCount(0);
    await preview.close();

    await page.getByRole('button', { name: UI.publish, exact: true }).click();
    await page.waitForURL(/\/share$/);
    const shareHeading = page.getByRole('heading', { name: UI.shareHeading });
    await expect(shareHeading).toBeVisible();
    const copyLink = page.getByRole('button', { name: UI.copyLink });
    if (CAPTURE) {
      // The stand-in address again; Copy link still copies the real one.
      await page
        .locator('main p.font-mono')
        .evaluate(
          (el) => (el.textContent = 'https://your-site.example/s/snack-duty-spring-season'),
        );
      // From the heading down to the buttons: the message and QR code below
      // are described in words.
      const [h, b] = await Promise.all([shareHeading.boundingBox(), copyLink.boundingBox()]);
      if (!h || !b) throw new Error('share heading or Copy link not on screen');
      const pad = 16;
      // The tick sits 60px above the heading (48px icon, 12px gap).
      const top = h.y - 60 - pad;
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOT_DIR}/share-step.png`,
        clip: { x: b.x - pad, y: top, width: b.width + 2 * pad, height: b.y + b.height + pad - top },
        animations: 'disabled',
      });
    }

    await copyLink.click();
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    await expect.poll(clipboard).toMatch(/\/s\/snack-duty-spring-season/);
    const copied = await clipboard();
    const slug = new URL(copied).pathname.split('/').pop();

    // The message holds the signup's name and the link, and copies with the
    // organizer's changes; the link goes back in if they took it out.
    const message = page.getByLabel(UI.messageBox);
    await expect(message).toHaveValue(`Snack duty — Spring season\nSign up here: ${copied}`);
    await message.fill('Snacks for the spring games, two families a game.');
    await page.getByRole('button', { name: UI.copyMessage }).click();
    await expect
      .poll(clipboard)
      .toBe(`Snacks for the spring games, two families a game.\n${copied}`);

    // The QR code is drawn in the browser and saved as a picture.
    const [qr] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: UI.downloadQr }).click(),
    ]);
    expect(qr.suggestedFilename()).toBe(`${slug}-qr.png`);

    await page.getByRole('link', { name: UI.doneSharing }).click();
    await page.waitForURL(/\/build$/);

    // "You can copy the link again at any time."
    const header = page
      .locator('header', { has: page.getByText(UI.publicLink, { exact: true }) })
      .locator('visible=true');
    await expect(header.getByText(UI.publicLink, { exact: true })).toBeVisible();
    if (CAPTURE) {
      // Each site has its own address; show a stand-in, not this test server's.
      // Only the text changes: the copy button still copies the real link.
      await header
        .locator('span.font-mono')
        .evaluate(
          (el) => (el.textContent = 'https://your-site.example/s/snack-duty-spring-season'),
        );
      // Crop to the title and the link: the whole header is too wide to read
      // once it is scaled into the article's column.
      const chip = header.getByRole('button', { name: UI.copyPublicLink }).locator('..');
      const title = header.getByRole('heading', { level: 1 });
      const pill = header.getByText('open', { exact: true });
      const boxes = await Promise.all([title, pill, chip].map((l) => l.boundingBox()));
      if (boxes.some((b) => !b)) throw new Error('title, status or link not on screen');
      const [t, st, c] = boxes as [
        NonNullable<(typeof boxes)[0]>,
        NonNullable<(typeof boxes)[0]>,
        NonNullable<(typeof boxes)[0]>,
      ];
      const pad = 16;
      const left = Math.min(t.x, c.x) - pad;
      const right = Math.max(st.x + st.width, c.x + c.width) + pad;
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOT_DIR}/published.png`,
        clip: {
          x: left,
          y: t.y - pad,
          width: right - left,
          height: c.y + c.height + pad - (t.y - pad),
        },
        animations: 'disabled',
      });
    }
    await header.getByRole('button', { name: UI.copyPublicLink }).click();
    await expect.poll(clipboard).toBe(copied);

    // What happens next: the link opens a page people can sign up on.
    await page.goto(copied);
    await expect(page.getByRole('heading', { name: 'Snack duty — Spring season' })).toBeVisible();
    await expect(page.getByText('Fruit and water')).toHaveCount(2);
    await expect(page.getByText('2 left', { exact: true })).toHaveCount(2);
    const signUp = page.getByRole('button', { name: new RegExp(`^${UI.signUp} for`) });
    await expect(signUp).toHaveCount(2);
    await expect(signUp.first()).toHaveText(UI.signUp);
  });

  test('a problem on the review page can be fixed there, and undone', async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(isMobile, 'the same steps on a phone');
    await loginAsSeededOrganizer(context);
    // A new signup starts with an empty slot. Fill in one more, and leave
    // another saying TBD, which has no one-tap fix.
    const created = await page.request.post('/api/signups', {
      data: {
        title: `Review fixes ${Date.now()}`,
        description: '',
        tags: [],
        visibility: 'unlisted',
        settings: {},
      },
    });
    expect(created.ok()).toBe(true);
    const id = (await created.json()).data.id as string;
    for (const slot of [
      { values: { what: 'Fruit and water', date: '2030-04-06' }, capacity: 2 },
      { values: { what: 'TBD', date: '2030-04-13' }, capacity: 2 },
    ]) {
      const added = await page.request.post(`/api/signups/${id}/slots`, { data: slot });
      expect(added.ok()).toBe(true);
    }

    await page.goto(`/app/signups/${id}`);
    await expect(page.getByRole('heading', { name: UI.reviewHeading })).toBeVisible();
    const notices = page.getByRole('region', { name: /to fix before you publish/ });
    const blank = notices.getByRole('listitem').filter({ hasText: 'nothing filled in' });
    const tbd = notices.getByRole('listitem').filter({ hasText: 'TBD' });
    await expect(notices.getByRole('heading')).toHaveText('2 things to fix before you publish');
    await expect(tbd.getByRole('link', { name: UI.fixInBuilder })).toBeVisible();
    await expect(page.getByText(UI.untitledSlot, { exact: true })).toHaveCount(1);

    // "For a slot with nothing in it, choose Remove it."
    await blank.getByRole('button', { name: UI.removeBlankSlot }).click();
    await expect(page.getByText('Removed the empty slot.')).toBeVisible();
    await expect(blank).toHaveCount(0);
    await expect(notices.getByRole('heading')).toHaveText('1 thing to fix before you publish');
    await expect(page.getByText(UI.untitledSlot, { exact: true })).toHaveCount(0);

    // "Right after a fix, you can choose Undo to put it back."
    const undo = page.getByRole('button', { name: UI.undo, exact: true });
    await expect(undo).toBeFocused();
    await undo.click();
    await expect(page.getByText('Undone.')).toBeVisible();
    await expect(undo).toHaveCount(0);
    await expect(blank).toBeVisible();
    await expect(notices.getByRole('heading')).toHaveText('2 things to fix before you publish');
    await expect(page.getByText(UI.untitledSlot, { exact: true })).toHaveCount(1);

    // "For other problems, choose Fix in the builder."
    await tbd.getByRole('link', { name: UI.fixInBuilder }).click();
    await page.waitForURL(/\/build$/);
  });

  test('a slot can be changed on the review page', async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'the same steps on a phone');
    await loginAsSeededOrganizer(context);
    const created = await page.request.post('/api/signups', {
      data: {
        title: `Review slots ${Date.now()}`,
        description: '',
        tags: [],
        visibility: 'unlisted',
        settings: {},
      },
    });
    expect(created.ok()).toBe(true);
    const id = (await created.json()).data.id as string;
    // Grouped by date, as the builder groups it, so a new date moves a slot.
    const grouped = await page.request.patch(`/api/signups/${id}`, {
      data: { settings: { groupByFieldRefs: ['date'] } },
    });
    expect(grouped.ok()).toBe(true);
    for (const slot of [
      { values: { what: 'Fruit and water', date: '2030-04-06' }, capacity: 2 },
      { values: { what: 'Napkins', date: '2030-04-13' }, capacity: 2 },
    ]) {
      const added = await page.request.post(`/api/signups/${id}/slots`, { data: slot });
      expect(added.ok()).toBe(true);
    }

    await page.goto(`/app/signups/${id}`);
    await expect(page.getByRole('heading', { name: UI.reviewHeading })).toBeVisible();
    const editor = page.locator('[data-testid^="slot-editor-"]');
    const saved = page.locator('#slots').getByRole('status');

    // "To change a slot, choose it."
    const fruit = page.getByRole('button', { name: /^Edit slot — Fruit and water/ });
    await expect(fruit).toContainText('2 people');
    await fruit.click();
    await expect(fruit).toHaveAttribute('aria-expanded', 'true');
    await expect(editor).toHaveCount(1);
    // Slots are added and removed in the builder, so this editor can't.
    await expect(editor.getByRole('button', { name: UI.duplicate })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: UI.delete })).toHaveCount(0);

    // "Change what you need, like its date or its Capacity, then choose Done
    // to save it."
    await editor.getByRole('spinbutton', { name: UI.capacity }).fill('3');
    await editor.getByRole('button', { name: UI.done }).click();
    await expect(editor).toHaveCount(0);
    await expect(saved).toHaveText(UI.saved);
    await expect(fruit).toContainText('3 people');
    await expect(fruit).toBeFocused();
    // Saved, not only shown.
    await page.reload();
    await expect(fruit).toContainText('3 people');

    // A new date moves the slot to that date's group, as a new row.
    await fruit.click();
    await editor.getByLabel(`${UI.date} value`).fill('2030-04-13');
    await editor.getByRole('button', { name: UI.done }).click();
    await expect(editor).toHaveCount(0);
    await expect(fruit).toHaveAccessibleName(/Sat, Apr 13$/);
    await expect(fruit).toHaveAttribute('aria-expanded', 'false');
    await expect(saved).toHaveText(UI.saved);
    await expect(fruit).toBeFocused();

    // "To close it without saving, choose Cancel."
    const napkins = page.getByRole('button', { name: /^Edit slot — Napkins/ });
    await napkins.click();
    await editor.getByRole('textbox', { name: `${UI.what} value` }).fill('Cups');
    await editor.getByRole('button', { name: UI.cancel }).click();
    await expect(editor).toHaveCount(0);
    await expect(napkins).toBeFocused();
    await page.reload();
    await expect(napkins).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit slot — Cups/ })).toHaveCount(0);
  });

  test('copies of a slot can be merged into one on the review page, and undone', async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(isMobile, 'the same steps on a phone');
    await loginAsSeededOrganizer(context);
    const created = await page.request.post('/api/signups', {
      data: {
        title: `Review merge ${Date.now()}`,
        description: '',
        tags: [],
        visibility: 'unlisted',
        settings: {},
      },
    });
    expect(created.ok()).toBe(true);
    const id = (await created.json()).data.id as string;
    // Two slots the same, each for two families.
    for (let i = 0; i < 2; i++) {
      const added = await page.request.post(`/api/signups/${id}/slots`, {
        data: { values: { what: 'Fruit and water', date: '2030-04-06' }, capacity: 2 },
      });
      expect(added.ok()).toBe(true);
    }

    await page.goto(`/app/signups/${id}`);
    const notices = page.getByRole('region', { name: /to fix before you publish/ });
    const copies = notices.getByRole('listitem').filter({ hasText: 'slots are the same' });
    const rows = page.getByText('Fruit and water', { exact: true });
    await expect(copies).toBeVisible();
    await expect(rows).toHaveCount(2);

    // "For slots that are copies of each other, choose Merge into one slot:
    // one slot takes all their spots."
    await copies.getByRole('button', { name: UI.mergeCopies }).click();
    await expect(page.getByText('Merged 2 slots into one for 4 people.')).toBeVisible();
    await expect(copies).toHaveCount(0);
    await expect(rows).toHaveCount(1);

    await page.getByRole('button', { name: UI.undo, exact: true }).click();
    await expect(page.getByText('Undone.')).toBeVisible();
    await expect(copies).toBeVisible();
    await expect(rows).toHaveCount(2);
  });

  test('people can sign up without an email', async ({ page, context, browser, isMobile }) => {
    test.skip(isMobile, 'the same steps on a phone; the desktop run takes the picture');
    await loginAsSeededOrganizer(context);
    // A published signup with a slot of two spots.
    const signup = await createPublishedSignup(page.request, {
      title: `No email ${Date.now()}`,
      slot: { values: { what: 'Fruit and water', date: '2030-04-06' }, capacity: 2 },
    });
    const signUp = new RegExp(`^${UI.signUp} for Fruit and water`);

    await page.goto(`/app/signups/${signup.id}/build`);
    await page.getByRole('tab', { name: UI.settings }).click();
    const form = page.getByRole('region', { name: UI.signupForm });
    const ask = form.getByRole('group', { name: UI.askForEmail });
    // "A signup asks people for their email unless you make it optional."
    await expect(ask.getByRole('radio', { name: UI.emailRequired })).toBeChecked();
    await ask.getByRole('radio', { name: UI.emailOptional }).check();
    await form.getByRole('button', { name: UI.save }).click();
    await expect(form.getByRole('status')).toHaveText(UI.saved);
    await expect(ask.getByRole('radio', { name: UI.emailOptional })).toBeChecked();
    await shot(page, form, 'email-setting');

    // Someone who leaves it blank sees their link on screen, and no email.
    const blank = await browser.newPage();
    await blank.goto(`/s/${signup.slug}`);
    await blank.getByRole('button', { name: signUp }).click();
    await expect(blank.getByLabel(UI.emailBoxOptional)).toHaveJSProperty('required', false);
    await blank.getByLabel('Your name').fill('Sam Example');
    await blank.getByRole('button', { name: 'Confirm' }).click();
    await expect(blank.getByText(/won.t email/)).toBeVisible();
    await expect(
      blank.getByRole('link', { name: new RegExp(`/s/${signup.slug}/c/`) }),
    ).toBeVisible();
    // The same browser can still change or cancel.
    await blank.getByRole('button', { name: 'Done' }).click();
    await expect(
      blank.getByRole('link', { name: /^Edit your signup for Fruit and water/ }),
    ).toBeVisible();
    await blank.close();

    // Sam's sign-up is on the Responses tab, where a lost link's old sign-up
    // is removed.
    await page.getByRole('tab', { name: UI.responses }).click();
    await expect(page.getByRole('cell', { name: 'Sam Example', exact: true })).toBeVisible();

    // Back to Required: new sign-ups are asked, and Sam keeps the spot.
    await page.goto(`/app/signups/${signup.id}/settings`);
    await ask.getByRole('radio', { name: UI.emailRequired }).check();
    await form.getByRole('button', { name: UI.save }).click();
    await expect(form.getByRole('status')).toHaveText(UI.saved);
    await expect(ask.getByRole('radio', { name: UI.emailRequired })).toBeChecked();
    const next = await browser.newPage();
    await next.goto(`/s/${signup.slug}`);
    await expect(next.getByText('1 left', { exact: true })).toBeVisible();
    await next.getByRole('button', { name: signUp }).click();
    await expect(next.getByLabel('Email', { exact: true })).toHaveJSProperty('required', true);
    await expect(next.getByLabel(UI.emailBoxOptional)).toHaveCount(0);
    await next.close();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('publish is under the three dots, and there is no preview', async ({ page, context }) => {
      await loginAsSeededOrganizer(context);
      // Most phones have a share sheet; the test browser may not, so it gets
      // one that notes what it was handed.
      await page.addInitScript(() => {
        const shared: ShareData[] = [];
        Object.defineProperty(window, '__shared', { value: shared });
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async (data: ShareData) => {
            shared.push(data);
          },
        });
      });
      const created = await page.request.post('/api/signups', {
        data: {
          title: `Phone publish ${Date.now()}`,
          description: '',
          tags: [],
          visibility: 'unlisted',
          settings: {},
        },
      });
      expect(created.ok()).toBe(true);
      const id = (await created.json()).data.id as string;

      await page.goto(`/app/signups/${id}/build`);
      await expect(page.getByRole('link', { name: UI.preview })).toBeHidden();
      await page.getByRole('button', { name: UI.moreActions }).click();
      await page.getByRole('button', { name: UI.publishOnPhone }).click();
      await expect(page.getByRole('heading', { name: UI.shareHeading })).toBeVisible();
      await expect(page.getByRole('button', { name: UI.copyLink })).toBeVisible();
      await page.getByRole('button', { name: UI.share }).click();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared))
        .toEqual([
          { title: expect.stringMatching(/^Phone publish/), url: expect.stringMatching(/\/s\//) },
        ]);
      await page.getByRole('link', { name: UI.doneSharing }).click();
      await expect(
        page.getByText(UI.publicLink, { exact: true }).locator('visible=true'),
      ).toBeVisible();
    });
  });
});
