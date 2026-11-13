import { mkdirSync } from 'node:fs';
import { shotDir } from './shots';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = shotDir('modes');
const GUARD_KEYS = [
  'jumpShot',
  'finishing',
  'passing',
  'handles',
  'perimeterDefense',
  'speed',
  'bounce',
  'size',
  'basketballIQ',
  'clutch',
];
const BIG_KEYS = [
  'jumpShot',
  'finishing',
  'rebounding',
  'playmaking',
  'interiorDefense',
  'speed',
  'bounce',
  'size',
  'basketballIQ',
  'clutch',
];

test.use({ viewport: { width: 390, height: 844 } });

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

async function spinAndPick(page: Page): Promise<void> {
  const before = await page.locator('.slot.filled').count();
  await page.locator('.spin-big').click();
  const chip = page.locator('.chip:enabled').first();
  await chip.waitFor({ state: 'visible' });
  await chip.click();
  await expect(page.locator('.slot.filled')).toHaveCount(before + 1);
}

async function finishSeason(page: Page): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const card = page.locator('[data-testid="moment-card"]');
    if (!(await card.isVisible().catch(() => false))) break;
    await card.locator('button').first().click();
    await page.waitForTimeout(200);
  }
  const skip = page.getByRole('button', { name: 'Skip to Result' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.locator('.award').first()).toBeVisible();
}

async function advanceToEnd(page: Page): Promise<void> {
  const advance = page.locator('.bottom .btn');
  await expect(advance).toHaveText(/Enter Playoffs|See Results/);
  const label = (await advance.textContent()) ?? '';
  await advance.click();
  if (label.includes('Playoffs')) {
    await expect(page.getByRole('button', { name: 'Skip to Result' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip to Result' }).click();
    await page.getByRole('button', { name: 'See Results' }).click();
  }
  await expect(page.locator('[data-testid="ovr"]')).toBeVisible();
}

function savedRun(id: string, keys: string[], position: 'guard' | 'big'): unknown {
  const picks: Record<string, unknown> = {};
  keys.forEach((attr, index) => {
    picks[attr] = {
      attr,
      val: 6 + (index % 4),
      playerName: `Squad ${id} ${index}`,
      playerShort: `S${index}`,
      team: ['BOS', 'LAL', 'DEN', 'MIA', 'CHI'][index % 5],
    };
  });
  return {
    v: 1,
    seed: `b-e2e-squad-${id}`,
    position,
    era: 'current',
    picks,
    spinIndex: keys.length,
    teamRespinUsed: false,
    playerRespinUsed: false,
    current: null,
    team: null,
    season: null,
    draft: null,
    moment: null,
    screen: 'builder',
  };
}

test('daily challenge plays to its end state, resumes after reload and locks the day', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-daily').click();
  await expect(page.getByTestId('daily-card')).toBeVisible();
  await expectNoVerticalOverflow(page, 'daily home');
  await shot(page, 'daily-card');

  const footballDay = await page.getByTestId('daily-nfl').isVisible().catch(() => false);
  test.skip(footballDay, 'today is a football day in the original rotation');
  await expect(page.getByTestId('daily-play')).toContainText(/Play Daily|Resume Daily/);
  await page.getByTestId('daily-play').click();

  await expect(page.getByTestId('daily-strip')).toBeVisible();
  await spinAndPick(page);
  await spinAndPick(page);
  await expectNoVerticalOverflow(page, 'daily builder');
  await shot(page, 'daily-builder');

  await page.reload();
  await expect(page.getByTestId('daily-strip')).toBeVisible();
  await expect(page.locator('.slot.filled')).toHaveCount(2);
  await expectNoVerticalOverflow(page, 'daily resumed builder');

  for (let index = 2; index < 10; index++) await spinAndPick(page);
  await page.getByRole('button', { name: 'Spin for Team' }).click();
  await page.locator('.spin-big').click();
  await expect(page.getByRole('button', { name: 'Simulate Season' })).toBeEnabled();
  await page.getByRole('button', { name: 'Simulate Season' }).click();
  await expect(page.getByText('Record')).toBeVisible();
  await finishSeason(page);
  await advanceToEnd(page);
  await expect(page.locator('.banner h1')).toHaveText(
    /NBA CHAMPIONS|LOST THE|OUT IN THE|MADE THE PLAYOFFS|MISSED THE PLAYOFFS/,
  );
  await expectNoVerticalOverflow(page, 'daily end');
  await shot(page, 'daily-end');

  await page.locator('.bottom .btn').click();
  await page.getByTestId('home-daily').click();
  await expect(page.getByTestId('daily-result')).toBeVisible();
  await expect(page.getByTestId('daily-result')).toContainText('OVR');
  await expect(page.getByTestId('daily-play')).toHaveCount(0);
  await expectNoVerticalOverflow(page, 'daily locked');
  await page.reload();
  await expect(page.getByTestId('home-daily')).toContainText('OVR');
  await page.getByTestId('home-daily').click();
  await expect(page.getByTestId('daily-result')).toContainText('OVR');
  await expectNoVerticalOverflow(page, 'daily locked after reload');
});

test('salary cap plays the daily grid, locks it and keeps an infinite run local', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-salary').click();
  await expect(page.getByTestId('salary-grid')).toBeVisible();
  await expectNoVerticalOverflow(page, 'salary grid');
  await shot(page, 'salary-grid');

  const cap = Number(((await page.getByTestId('salary-cap').locator('.sc-cap').textContent()) ?? '').replace(/[^0-9]/g, ''));
  expect(cap).toBeGreaterThanOrEqual(130);

  const columns = ['finishing', 'shooting', 'defense', 'playmaking', 'size'];
  for (const column of columns) {
    const cells = page.locator(`[data-testid^="salary-${column}-"]`);
    await cells.nth(4).click();
  }
  await expect(page.getByTestId('salary-confirm')).toBeEnabled();
  await page.getByTestId('salary-confirm').click();
  await expect(page.getByTestId('salary-result')).toBeVisible();
  await expect(page.getByTestId('salary-result')).toContainText('OVR');
  await expectNoVerticalOverflow(page, 'salary result');
  await shot(page, 'salary-result');

  await page.reload();
  await page.getByTestId('home-salary').click();
  await expect(page.getByTestId('salary-result')).toContainText('OVR');
  await expect(page.getByTestId('salary-confirm')).toContainText('Already played today');

  await page.getByTestId('salary-mode').click();
  await expect(page.getByTestId('salary-mode')).toHaveText('INFINITE');
  for (const column of columns) {
    await page.locator(`[data-testid^="salary-${column}-"]`).nth(4).click();
  }
  await expect(page.getByTestId('salary-confirm')).toBeEnabled();
  await page.getByTestId('salary-confirm').click();
  await expect(page.getByTestId('salary-result')).toContainText('OVR');
  await expectNoVerticalOverflow(page, 'salary infinite result');
  await shot(page, 'salary-infinite');
});

test('squad builder fills five slots, simulates the season and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-squad').click();
  await expect(page.getByTestId('squad-slots')).toBeVisible();
  await expectNoVerticalOverflow(page, 'squad empty');
  await shot(page, 'squad-empty');

  await page.getByTestId('squad-build-PG').click();
  await expect(page.getByTestId('squad-strip')).toBeVisible();
  for (let index = 0; index < 10; index++) await spinAndPick(page);
  await page.getByRole('button', { name: 'Add to squad' }).click();
  await expect(page.getByTestId('squad-slot-PG')).toContainText('OVR');

  const squad = {
    v: 1,
    seed: 'b-e2e-squad',
    team: null,
    season: 0,
    slots: [
      { id: 'PG', pos: 'guard', run: savedRun('PG', GUARD_KEYS, 'guard') },
      { id: 'SG', pos: 'guard', run: savedRun('SG', GUARD_KEYS, 'guard') },
      { id: 'SF', pos: 'guard', run: savedRun('SF', GUARD_KEYS, 'guard') },
      { id: 'PF', pos: 'big', run: savedRun('PF', BIG_KEYS, 'big') },
      { id: 'C', pos: 'big', run: savedRun('C', BIG_KEYS, 'big') },
    ],
    result: null,
  };
  await page.evaluate((value) => localStorage.setItem('bab:squad:v1', JSON.stringify(value)), squad);
  await page.reload();
  await page.getByTestId('home-squad').click();
  await expect(page.getByTestId('squad-slots').locator('.sq-slot.filled')).toHaveCount(5);
  await expect(page.getByTestId('squad-team')).toBeVisible();
  await expectNoVerticalOverflow(page, 'squad ready');
  await shot(page, 'squad-ready');

  await page.getByTestId('squad-team').locator('.team-btn').first().click();
  await page.getByTestId('squad-simulate').click();
  await expect(page.getByTestId('squad-result')).toBeVisible();
  await expect(page.getByTestId('squad-result')).toContainText('SEED');
  await expectNoVerticalOverflow(page, 'squad result');
  await shot(page, 'squad-result');

  await page.reload();
  await page.getByTestId('home-squad').click();
  await expect(page.getByTestId('squad-result')).toContainText('SEED');
});
