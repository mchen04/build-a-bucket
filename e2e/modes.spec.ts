import { mkdirSync } from 'node:fs';
import { shotDir } from './shots';
import { expect, test, type Page } from '@playwright/test';
import { previewFor, type SalCard } from '../src/shared/engine/salary';
import { gradeFor } from '../src/shared/engine/rules';

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

async function expectSingleTeamRespin(page: Page): Promise<string> {
  const spinButton = page.locator('.spin-big');
  await expect(spinButton).toHaveText('SPIN');
  await spinButton.click();
  await expect(spinButton).toHaveText('RESPIN · 1 LEFT');
  const first = ((await page.locator('.reel-value').textContent()) ?? '').trim();
  await page.locator('.seg button').nth(1).click();
  await expect(page.locator('.team-btn[aria-pressed="true"]')).toHaveText(first);
  expect(await page.locator('.team-btn:enabled').count()).toBe(0);
  await page.locator('.seg button').first().click();
  await expect(spinButton).toHaveText('RESPIN · 1 LEFT');
  await spinButton.click();
  await expect(spinButton).toHaveText('RESPIN USED');
  const final = ((await page.locator('.reel-value').textContent()) ?? '').trim();
  expect(final).not.toBe(first);
  await expect(spinButton).toBeDisabled();
  await page.locator('.seg button').nth(1).click();
  await expect(page.locator('.team-btn[aria-pressed="true"]')).toHaveText(final);
  expect(await page.locator('.team-btn:enabled').count()).toBe(0);
  await page.locator('.seg button').first().click();
  await page.reload();
  await expect(page.locator('.spin-big')).toBeDisabled();
  await expect(page.locator('.spin-big')).toHaveText('RESPIN USED');
  await expect(page.locator('.reel-value')).toHaveText(final);
  await page.locator('.seg button').nth(1).click();
  await expect(page.locator('.team-btn[aria-pressed="true"]')).toHaveText(final);
  expect(await page.locator('.team-btn:enabled').count()).toBe(0);
  await page.locator('.seg button').first().click();
  return final;
}

async function finishSeason(page: Page): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const card = page.locator('[data-testid="moment-card"]');
    await expect(card.or(page.locator('.award').first())).toBeVisible({ timeout: 30_000 });
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

function strongRun(id: string, keys: string[], position: 'guard' | 'big'): unknown {
  const picks: Record<string, unknown> = {};
  keys.forEach((attr, index) => {
    picks[attr] = {
      attr,
      val: 10,
      playerName: `Strong ${id} ${index}`,
      playerShort: `T${index}`,
      team: ['BOS', 'LAL', 'DEN', 'MIA', 'CHI'][index % 5],
    };
  });
  return {
    v: 1,
    seed: `b-e2e-strong-${id}`,
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

test('solo team spin allows one respin and locks the team across reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('bab:v1', JSON.stringify(value)), savedRun('solo', GUARD_KEYS, 'guard'));
  await page.reload();
  await page.getByRole('button', { name: 'Spin for Team' }).click();
  await expectSingleTeamRespin(page);
  await expect(page.getByRole('button', { name: 'Simulate Season' })).toBeEnabled();
});

test('a player respin after a team respin keeps the respun team', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('bab:v1', JSON.stringify(value)), savedRun('respin', [], 'guard'));
  await page.reload();
  await page.locator('.spin-big').click();
  const team = page.getByTestId('source-team');
  const name = page.getByTestId('source-name');
  await expect(name).toBeVisible();
  await page.getByRole('button', { name: /Respin Team/ }).click();
  await expect(page.getByRole('button', { name: /Respin Team · used/ })).toBeDisabled({ timeout: 5_000 });
  const respunTeam = ((await team.textContent()) ?? '').split(' · ')[0];
  const respunName = await name.textContent();
  await page.getByRole('button', { name: /Respin Player/ }).click();
  await expect(page.getByRole('button', { name: /Respin Player · used/ })).toBeDisabled({ timeout: 5_000 });
  await expect(name).not.toHaveText(respunName ?? '');
  expect(((await team.textContent()) ?? '').split(' · ')[0]).toBe(respunTeam);
});

test('daily challenge plays to its end state, resumes after reload and locks the day', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T18:00:00Z'));
  await page.goto('/');
  await page.getByTestId('home-daily').click();
  await expect(page.getByTestId('daily-card')).toBeVisible();
  await expectNoVerticalOverflow(page, 'daily home');
  await shot(page, 'daily-card');

  await expect(page.getByTestId('daily-nfl')).toHaveCount(0);
  await expect(page.getByTestId('daily-card')).toContainText('BASKETBALL');
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
  await expectSingleTeamRespin(page);
  await expect(page.getByRole('button', { name: 'Simulate Season' })).toBeEnabled();
  await page.getByRole('button', { name: 'Simulate Season' }).click();
  await expect(page.getByText('Record')).toBeVisible();
  await finishSeason(page);
  await advanceToEnd(page);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="ovr"]')).toBeVisible();
  await expect(page.locator('.banner h1')).toHaveText(
    /NBA CHAMPIONS|LOST THE|OUT IN THE|MADE THE PLAYOFFS|MISSED THE PLAYOFFS/,
  );
  await expectNoVerticalOverflow(page, 'daily end');
  await shot(page, 'daily-end');

  await page.locator('.bottom .btn').click();
  await page.getByTestId('home-daily').click();
  await expect(page.getByTestId('daily-result')).toBeVisible();
  await expect(page.getByTestId('daily-result')).toContainText('OVR');
  await expect(page.getByTestId('daily-build')).toBeVisible();
  await expect(page.getByTestId('daily-run')).toBeVisible();
  await expect(page.getByTestId('daily-awards')).toBeVisible();
  await expect(page.getByTestId('daily-view')).toBeVisible();
  await expect(page.getByTestId('daily-play')).toHaveCount(0);
  const stored = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('bab:daily:v1') ?? '{}') as {
      days?: Record<string, { run?: { season?: { wins: number; seed: number; standings: { wins: number }[] } } }>;
    };
    const season = Object.values(store.days ?? {})[0]?.run?.season;
    if (!season) return null;
    const sorted = season.standings.every((row, index, all) => index === 0 || (all[index - 1] as { wins: number }).wins >= row.wins);
    const above = season.standings.slice(0, season.seed - 1);
    return { wins: season.wins, seed: season.seed, sorted, consistent: above.every((row) => row.wins >= season.wins) };
  });
  expect(stored).not.toBeNull();
  expect(stored?.sorted).toBe(true);
  expect(stored?.consistent).toBe(true);
  await expect(page.getByTestId('daily-result')).toContainText(`${stored?.wins}-`);
  await expect(page.getByTestId('daily-result')).toContainText(`SEED #${stored?.seed}`);
  await expectNoVerticalOverflow(page, 'daily locked');
  await shot(page, 'daily-result-full');
  await page.getByTestId('daily-view').click();
  await expect(page.locator('[data-testid="ovr"]')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('home-daily')).toContainText('OVR');
  await page.getByTestId('home-daily').click();
  await expect(page.getByTestId('daily-result')).toContainText('OVR');
  await expect(page.getByTestId('daily-build')).toBeVisible();
  await expect(page.getByTestId('daily-run')).toBeVisible();
  await expect(page.getByTestId('daily-view')).toBeVisible();
  await expectNoVerticalOverflow(page, 'daily locked after reload');
  await shot(page, 'daily-result-reload');
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

test('salary powers shuffle, scout a grade and survive a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-salary').click();
  await expect(page.getByTestId('salary-grid')).toBeVisible();

  const columns = ['finishing', 'shooting', 'defense', 'playmaking', 'size'];
  const shootingNames = () => page.locator('[data-testid^="salary-shooting-"] .sc-name').allTextContents();
  const before = await shootingNames();
  await page.getByTestId('salary-shooting-2').click();
  await expect(page.getByTestId('salary-shooting-2')).toHaveAttribute('aria-pressed', 'true');
  const spentOf = async () =>
    Number((((await page.getByTestId('salary-cap').locator('.sc-spent').textContent()) ?? '').replace(/[^0-9]/g, '')));
  const spentBefore = await spentOf();

  await page.getByTestId('salary-powers').click();
  await expect(page.getByTestId('salary-powers-menu')).toBeVisible();
  await expect(page.getByTestId('salary-power-shuffle-badge')).toHaveText('1');
  await expect(page.getByTestId('salary-power-scout-badge')).toHaveText('1');
  await expectNoVerticalOverflow(page, 'salary powers');
  await page.getByTestId('salary-power-shuffle').click();
  await expect(page.getByTestId('salary-shuffle-column-shooting')).toBeVisible();
  await expect(page.getByTestId('salary-shuffle-row-0')).toBeVisible();
  await expectNoVerticalOverflow(page, 'salary shuffle targets');
  await page.getByTestId('salary-power-cancel').click();
  await expect(page.getByTestId('salary-shuffle-hint')).toHaveCount(0);
  await page.getByTestId('salary-powers').click();
  await expect(page.getByTestId('salary-power-shuffle-badge')).toHaveText('1');
  await page.getByTestId('salary-power-shuffle').click();
  await expect(page.getByTestId('salary-shuffle-column-shooting')).toBeVisible();
  await page.getByTestId('salary-shuffle-column-shooting').click();
  await expect(page.getByTestId('salary-shuffle-column-shooting')).toHaveCount(0);
  const after = await shootingNames();
  expect(after).not.toEqual(before);
  expect([...after].sort()).toEqual([...before].sort());
  await expect(page.getByTestId('salary-shooting-2')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(spentOf).toBe(spentBefore - 30);
  await page.getByTestId('salary-powers').click();
  await expect(page.getByTestId('salary-power-shuffle-badge')).toHaveText('0');
  await expect(page.getByTestId('salary-power-shuffle')).toBeDisabled();

  await page.reload();
  await page.getByTestId('home-salary').click();
  await expect(page.getByTestId('salary-grid')).toBeVisible();
  expect(await shootingNames()).toEqual(after);
  await page.getByTestId('salary-powers').click();
  await expect(page.getByTestId('salary-power-shuffle-badge')).toHaveText('0');
  await expect(page.getByTestId('salary-power-shuffle')).toBeDisabled();

  await page.getByTestId('salary-power-scout').click();
  await expect(page.getByTestId('salary-scout-hint')).toBeVisible();
  const target = page.locator('[data-testid="salary-shooting-1"]');
  await target.click();
  const grade = page.getByTestId('salary-grade-shooting-1');
  await expect(grade).toHaveText(/^(F|D|C-?|C\+|B-?|B\+|A-?|A\+|S)$/);
  const gradeText = (await grade.textContent()) ?? '';
  await expect(target).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('salary-powers').click();
  await expect(page.getByTestId('salary-power-scout-badge')).toHaveText('0');

  await page.reload();
  await page.getByTestId('home-salary').click();
  await expect(page.getByTestId('salary-grade-shooting-1')).toHaveText(gradeText);
  await page.getByTestId('salary-powers').click();
  await expect(page.getByTestId('salary-power-scout-badge')).toHaveText('0');

  const picked: SalCard[] = [];
  for (const column of columns) {
    const cell = page.locator(`[data-testid^="salary-${column}-"]`).nth(4);
    await cell.click();
    picked.push({ attrs: JSON.parse((await cell.getAttribute('data-attrs')) ?? '{}') } as SalCard);
  }
  const spent = ((await page.getByTestId('salary-cap').locator('.sc-spent').textContent()) ?? '').trim();
  const expected = previewFor(picked);
  await page.getByTestId('salary-confirm').click();
  await expect(page.getByTestId('salary-result')).toContainText('OVR');
  await expect(page.getByTestId('salary-result')).toContainText(spent);
  await expect(page.getByTestId('salary-result')).toContainText('TODAY IS LOCKED IN');
  await expect(page.getByTestId('salary-result')).toContainText(/playoffs/i);
  const stat = (value: number, label: string) => new RegExp(`${String(value).replace('.', '\\.')}\\s*${label}`);
  await expect(page.getByTestId('salary-result')).toContainText(stat(expected.ppg, 'PPG'));
  await expect(page.getByTestId('salary-result')).toContainText(stat(expected.rpg, 'RPG'));
  await expect(page.getByTestId('salary-result')).toContainText(stat(expected.apg, 'APG'));
  await shot(page, 'salary-powers');

  await page.getByTestId('salary-mode').click();
  await expect(page.getByTestId('salary-mode')).toHaveText('INFINITE');
  await page.getByTestId('salary-powers').click();
  await expect(page.getByTestId('salary-powers-menu')).toContainText('one use each run');
  await expect(page.getByTestId('salary-power-shuffle-badge')).toHaveText('1');
  await page.getByTestId('salary-power-scout').click();
  const scoutedCell = page.getByTestId('salary-shooting-1');
  const scoutedName = ((await scoutedCell.locator('.sc-name').textContent()) ?? '').trim();
  await scoutedCell.click();
  await expect(page.getByTestId('salary-grade-shooting-1')).toHaveText(/^(F|D|C-?|C\+|B-?|B\+|A-?|A\+|S)$/);
  await page.getByTestId('salary-powers').click();
  await page.getByTestId('salary-power-shuffle').click();
  await expect(page.getByTestId('salary-shuffle-row-1')).toBeVisible();
  await page.getByTestId('salary-shuffle-row-1').click();
  await expect(page.getByTestId('salary-shuffle-row-1')).toHaveCount(0);
  await expect(page.getByTestId('salary-grade-shooting-1')).toHaveCount(0);
  const moved = page.locator('.sc-cell:has(.sc-grade)');
  await expect(moved).toHaveCount(1);
  await expect(moved.locator('.sc-name')).toHaveText(scoutedName);
  const movedAttrs = JSON.parse((await moved.getAttribute('data-attrs')) ?? '{}') as Record<string, number>;
  const movedValues = Object.values(movedAttrs);
  const movedMean = movedValues.reduce((sum, value) => sum + value, 0) / movedValues.length;
  await expect(moved.locator('.sc-grade')).toHaveText(gradeFor(movedMean));
  for (const column of columns) await page.locator(`[data-testid^="salary-${column}-"]`).nth(4).click();
  await page.getByTestId('salary-confirm').click();
  await expect(page.getByTestId('salary-result')).toContainText('SEASON RESULT');
  await expect(page.getByTestId('salary-powers')).toBeDisabled();
});

test('squad builder fills five slots, simulates the season and survives a reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await page.getByTestId('squad-review').click();
  await expect(page.getByTestId('squad-ready')).toBeVisible();
  await expect(page.getByTestId('squad-lineup').locator('.lineup-row')).toHaveCount(5);
  await expect(page.getByTestId('squad-ready')).not.toContainText('CHAMPIONS');
  await expectNoVerticalOverflow(page, 'squad review');
  await shot(page, 'squad-review');
  await page.getByTestId('squad-simulate').click();
  await expect(page.getByTestId('squad-season')).toBeVisible();
  await expect(page.getByTestId('squad-season')).not.toContainText('CHAMPIONS');
  await shot(page, 'squad-season');
  await page.getByTestId('squad-season-skip').click();
  await expect(page.getByTestId('squad-standings')).toBeVisible();
  await expect(page.getByTestId('squad-standings')).not.toContainText('CHAMPIONS');
  await expect(page.getByTestId('squad-standings')).not.toContainText('Missed the Playoffs');
  await expectNoVerticalOverflow(page, 'squad standings');
  await shot(page, 'squad-standings');
  const standingsNext = page.getByTestId('squad-standings-next');
  if ((await standingsNext.textContent())?.includes('Playoffs')) {
    await page.clock.install();
    await standingsNext.click();
    await expect(page.getByTestId('squad-playoffs')).toBeVisible();
    const rounds = page.getByTestId('squad-playoff-rounds').locator('.round');
    await expect(page.getByTestId('squad-playoff-banner')).toHaveCount(0);
    await page.clock.runFor(650);
    await expect(rounds).toHaveCount(1);
    await shot(page, 'squad-playoffs-first-round');
    await page.clock.runFor(5 * 520);
    await expect(page.getByTestId('squad-playoff-banner')).toBeVisible();
    expect(await rounds.count()).toBeGreaterThan(0);
    await shot(page, 'squad-playoffs');
    await page.getByTestId('squad-recap-next').click();
  } else {
    await standingsNext.click();
  }
  await expect(page.getByTestId('squad-result')).toBeVisible();
  await expect(page.getByTestId('squad-result')).toContainText('SEED');
  await expect(page.getByTestId('squad-again')).toHaveText('Another season');
  await expect(page.getByTestId('squad-new')).toHaveText('New squad');
  await expectNoVerticalOverflow(page, 'squad result');
  await shot(page, 'squad-result');

  await page.reload();
  await page.getByTestId('home-squad').click();
  await expect(page.getByTestId('squad-result')).toContainText('SEED');
  await expect(page.getByTestId('squad-again')).toBeVisible();
  await expect(page.getByTestId('squad-new')).toBeVisible();
});

test('squad playoff walkthrough reveals every round before the recap', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/');
  const squad = {
    v: 1,
    seed: 'scan-0',
    team: 'BOS',
    season: 0,
    slots: [
      { id: 'PG', pos: 'guard', run: strongRun('PG', GUARD_KEYS, 'guard') },
      { id: 'SG', pos: 'guard', run: strongRun('SG', GUARD_KEYS, 'guard') },
      { id: 'SF', pos: 'guard', run: strongRun('SF', GUARD_KEYS, 'guard') },
      { id: 'PF', pos: 'big', run: strongRun('PF', BIG_KEYS, 'big') },
      { id: 'C', pos: 'big', run: strongRun('C', BIG_KEYS, 'big') },
    ],
    result: null,
  };
  await page.evaluate((value) => localStorage.setItem('bab:squad:v1', JSON.stringify(value)), squad);
  await page.reload();
  await page.getByTestId('home-squad').click();
  await expect(page.getByTestId('squad-slots').locator('.sq-slot.filled')).toHaveCount(5);
  await page.getByTestId('squad-review').click();
  await page.getByTestId('squad-simulate').click();
  await expect(page.getByTestId('squad-season')).toBeVisible();
  await page.getByTestId('squad-season-skip').click();
  await expect(page.getByTestId('squad-standings')).toBeVisible();
  const next = page.getByTestId('squad-standings-next');
  await expect(next).toContainText('Playoffs');
  await next.click();
  await expect(page.getByTestId('squad-playoffs')).toBeVisible();

  const stamp = (label: string) => console.log(`[squad-walkthrough] ${label} ${new Date().toISOString()}`);
  const rounds = page.getByTestId('squad-playoff-rounds').locator('.round');
  const banner = page.getByTestId('squad-playoff-banner');
  await expect(rounds).toHaveCount(0);
  await expect(banner).toHaveCount(0);
  let seen = 0;
  for (let guard = 0; guard < 8 && seen < 4; guard++) {
    await page.clock.runFor(519);
    await page.clock.runFor(1);
    const count = await rounds.count();
    if (count > seen) {
      seen = count;
      stamp(`rounds=${count}`);
      await shot(page, `squad-playoffs-${count}`);
    }
  }
  expect(await rounds.count(), 'fixture seed scan-0 must reach and win all four rounds; re-run the seed scan if this stops holding').toBe(4);
  await expect(banner).toBeVisible();
  stamp(`all-rounds-banner rounds=${await rounds.count()}`);
  const last = rounds.last();
  await expect(last).toContainText('NBA Finals');
  expect(await last.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, animation: style.animationName };
  })).toEqual({ opacity: '1', animation: 'none' });
  await shot(page, 'squad-playoffs-all');
  expect((await rounds.locator('.rname').allInnerTexts()).map((label) => label.toLowerCase())).toEqual([
    'first round',
    'conference semifinals',
    'conference finals',
    'nba finals',
  ]);
  await expect(banner).toContainText('NBA CHAMPIONS!');
  await expect(banner).toContainText(/NBA CHAMPIONS!.*\d+-\d+ Season · \d+-\d+ vs [A-Z]{2,4}/);
  await page.getByTestId('squad-recap-next').click();
  await expect(page.getByTestId('squad-result')).toContainText('SEED');
  stamp('recap');
  await shot(page, 'squad-recap');
});
