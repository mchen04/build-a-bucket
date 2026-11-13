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

function savedPlayoffRun(): unknown {
  const games = Array.from({ length: 82 }, (_, index) => ({
    g: index + 1,
    won: index % 2 === 0,
    home: index % 3 === 0,
    opponent: index % 2 === 0 ? 'BOS' : 'NYK',
    mySc: index % 2 === 0 ? 110 : 102,
    oppSc: index % 2 === 0 ? 102 : 110,
    pts: 24,
    reb: 6,
    ast: 5,
  }));
  const standings = [
    { short: 'BOS', wins: 58 },
    { short: 'NYK', wins: 54 },
    { short: 'MIL', wins: 50 },
    { short: 'CLE', wins: 48 },
    { short: 'ORL', wins: 45 },
    { short: 'IND', wins: 43 },
    { short: 'MIA', wins: 44, isUs: true },
    { short: 'PHI', wins: 42 },
    { short: 'ATL', wins: 40 },
    { short: 'CHI', wins: 38 },
    { short: 'BKN', wins: 34 },
    { short: 'TOR', wins: 33 },
    { short: 'CHA', wins: 31 },
    { short: 'DET', wins: 30 },
    { short: 'WAS', wins: 22 },
  ];
  return {
    v: 1,
    seed: 'b-e2e-playoffs',
    position: 'guard',
    era: 'current',
    picks: {},
    spinIndex: 10,
    teamRespinUsed: true,
    playerRespinUsed: false,
    current: null,
    team: 'MIA',
    screen: 'season',
    season: {
      ovr: 88,
      wins: 44,
      losses: 38,
      position: 'guard',
      ppg: 26.4,
      rpg: 5.1,
      apg: 7.2,
      spg: 1.4,
      bpg: 0.4,
      tov: 2.6,
      fgPct: 47,
      threePct: 38,
      ftPct: 86,
      per: 19.4,
      games,
      gameLog: games.map((game) => (game.won ? 'W' : 'L')),
      bestGame: { ...games[0], pts: 42 },
      conference: 'east',
      seed: 7,
      madePlayoffs: true,
      standings,
      playoffRounds: [
        {
          type: 'playin',
          advanced: true,
          newSeed: 7,
          games: ['W'],
          opponent: { short: 'PHI', wins: 42 },
          label: 'Beat PHI — Earned #7 Seed',
        },
        {
          type: 'series',
          name: 'First Round',
          roundIndex: 0,
          opponent: { short: 'NYK', wins: 54, seed: 2 },
          won: true,
          wins: 4,
          losses: 2,
          games: ['W', 'L', 'W', 'W', 'L', 'W'],
        },
        {
          type: 'series',
          name: 'Conference Semifinals',
          roundIndex: 1,
          opponent: { short: 'MIL', wins: 50, seed: 3 },
          won: true,
          wins: 4,
          losses: 3,
          games: ['W', 'W', 'L', 'L', 'W', 'L', 'W'],
        },
        {
          type: 'series',
          name: 'Conference Finals',
          roundIndex: 2,
          opponent: { short: 'BOS', wins: 58, seed: 1 },
          won: true,
          wins: 4,
          losses: 1,
          games: ['W', 'W', 'L', 'W', 'W'],
        },
        {
          type: 'series',
          name: 'NBA Finals',
          roundIndex: 3,
          opponent: { short: 'OKC', wins: 58, seed: 1, isOtherConf: true },
          won: false,
          wins: 2,
          losses: 4,
          games: ['L', 'W', 'L', 'W', 'L', 'L'],
        },
      ],
      champion: false,
      team: 'MIA',
      mvp: true,
      dpoy: false,
      finalsOpp: 'OKC',
      finalsSeries: '2-4',
      displayMvp: { name: 'You', short: 'You', team: 'MIA', ppg: 26.4, rpg: 5.1, apg: 7.2, isPlayer: true },
      displayDpoy: { name: 'Victor Wembanyama', short: 'Wembanyama', team: 'SAS', spg: 1.4, bpg: 3.5 },
      goatRank: 22,
    },
  };
}

test('reveals the saved playoff bracket and the end screen', async ({ page }) => {
  await page.addInitScript((run) => {
    localStorage.setItem('bab:v1', JSON.stringify(run));
  }, savedPlayoffRun());
  await page.goto('/');

  await expect(page.getByText('Record')).toBeVisible();
  await page.getByRole('button', { name: 'Skip to Result' }).click();
  await expect(page.locator('.award').first()).toBeVisible();
  await page.getByRole('button', { name: 'Enter Playoffs' }).click();

  await expect(page.getByRole('button', { name: 'Skip to Result' })).toBeVisible();
  await expectNoVerticalOverflow(page, 'playoffs tip off');
  await shot(page, '12-playoffs-tip-off');

  await page.getByRole('button', { name: 'Skip to Result' }).click();
  await expect(page.locator('.round')).toHaveCount(5);
  await expect(page.locator('.round').first()).toContainText('Play-In');
  await expect(page.locator('.round').last()).toContainText('NBA Finals');
  await expect(page.locator('.banner h1')).toHaveText('SEASON OVER');
  await expectNoVerticalOverflow(page, 'playoffs bracket');
  await shot(page, '13-playoffs-bracket');

  await page.getByRole('button', { name: 'See Results' }).click();
  await expect(page.getByRole('button', { name: 'New Build' })).toBeVisible();
  await expect(page.locator('.award').filter({ hasText: 'GOAT' })).toContainText('#22 all-time');
  await expectNoVerticalOverflow(page, 'end screen');
  await shot(page, '14-end-after-playoffs');
});
