import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = '/Users/michaelchen/Work/build-a-bucket-t_614e29cd/after/turn1';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function expectNoVerticalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector('.app') as HTMLElement | null;
    return {
      document: root.scrollHeight - window.innerHeight,
      app: app ? app.scrollHeight - app.clientHeight : 0,
    };
  });
  expect(overflow.document, `${label} scrolls vertically`).toBeLessThanOrEqual(1);
  expect(overflow.app, `${label} overflows its frame`).toBeLessThanOrEqual(1);
}

async function pickCount(page: Page): Promise<number> {
  return page.locator('.slot.filled').count();
}

async function spinAndPick(page: Page): Promise<void> {
  const before = await page.locator('.slot.filled').count();
  await page.locator('.spin-big').click();
  const chip = page.locator('.chip:enabled').first();
  await chip.waitFor({ state: 'visible' });
  await chip.click();
  await expect(page.locator('.slot.filled')).toHaveCount(before + 1);
}

test('plays a full guard current run, restores mid-build, and fits a phone screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Play · Guard · Current$/ })).toBeVisible();
  await expectNoVerticalOverflow(page, 'home');
  await shot(page, '01-home');

  await page.getByRole('button', { name: /^Play · Guard · Current$/ }).click();

  await expect(page.locator('.spin-big')).toBeVisible();
  await expectNoVerticalOverflow(page, 'builder start');
  await shot(page, '02-builder-start');

  await spinAndPick(page);
  await spinAndPick(page);
  await spinAndPick(page);
  await expect(page.locator('.slot.filled')).toHaveCount(3);

  await page.reload();
  await expect(page.locator('.slot.filled')).toHaveCount(3);
  await expect(page.locator('.top').getByText('3/10')).toBeVisible();
  expect(await pickCount(page)).toBe(3);
  await expectNoVerticalOverflow(page, 'builder after reload');
  await shot(page, '03-builder-restored-after-reload');

  for (let index = 3; index < 10; index++) {
    await spinAndPick(page);
  }

  await expect(page.locator('.slot.filled')).toHaveCount(10);
  await expect(page.getByText('Build complete')).toBeVisible();
  await expectNoVerticalOverflow(page, 'builder complete');
  await shot(page, '04-build-complete');

  await page.getByRole('button', { name: 'Spin for Team' }).click();
  await expect(page.locator('.spin-big')).toBeVisible();
  await expectNoVerticalOverflow(page, 'team spin');
  await shot(page, '05-team-spin');

  await page.locator('.spin-big').click();
  await expect(page.getByRole('button', { name: 'Simulate Season' })).toBeEnabled();
  await expect(page.locator('.card').filter({ hasText: /OFF \d+ · DEF \d+/ })).toBeVisible();
  await shot(page, '06-team-result');

  await page.getByRole('button', { name: 'Simulate Season' }).click();
  await expect(page.getByText('Record')).toBeVisible();
  await expectNoVerticalOverflow(page, 'season');
  await shot(page, '07-season-ticking');

  await page.getByRole('button', { name: 'Skip to Result' }).click();
  await expect(page.locator('.award').first()).toBeVisible();
  await expectNoVerticalOverflow(page, 'season result');
  await shot(page, '08-season-result');

  const advance = page.locator('.bottom .btn');
  const label = (await advance.textContent()) ?? '';
  const seed = await page.locator('.body').getByText(/^#\d+$/).first().textContent();
  await advance.click();

  if (label.includes('Playoffs')) {
    await expect(page.getByRole('button', { name: 'Skip to Result' })).toBeVisible();
    await shot(page, '09-playoffs-tip-off');
    await page.getByRole('button', { name: 'Skip to Result' }).click();
    await expect(page.locator('.banner')).toBeVisible();
    await expectNoVerticalOverflow(page, 'playoffs result');
    await shot(page, '10-playoffs-result');
    await page.getByRole('button', { name: 'See Results' }).click();
  }

  await expect(page.getByRole('button', { name: 'New Build' })).toBeVisible();
  await expect(page.getByText('Archetype')).toBeVisible();
  await expectNoVerticalOverflow(page, 'end');
  await shot(page, '11-end');

  await page.getByRole('button', { name: 'New Build' }).click();
  await expect(page.getByRole('button', { name: /^Play · Guard · Current$/ })).toBeVisible();
  await expect(page.locator('.slot')).toHaveCount(0);
  console.log(`playoff seed text: ${seed ?? 'n/a'}; advance label: ${label.trim()}`);
});

test('shows the limitation text for the online modes', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.home-item').filter({ hasText: 'Blacktop · Compete · Versus' });
  await expect(row).toContainText('Live multiplayer is not available in this rebuild yet.');
  await expect(page.locator('.home-item .lock').first()).toHaveText('Coming in this rebuild');
  await expectNoVerticalOverflow(page, 'home limitations');
});
