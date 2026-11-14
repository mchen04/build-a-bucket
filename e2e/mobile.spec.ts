import { mkdirSync } from 'node:fs';
import { shotDir } from './shots';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = shotDir('mobile');
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

async function answerMoments(page: Page, name = 'moment'): Promise<number> {
  let seen = 0;
  for (let guard = 0; guard < 8; guard++) {
    const card = page.locator('[data-testid="moment-card"]');
    await expect(card.or(page.locator('.award').first())).toBeVisible({ timeout: 30_000 });
    if (!(await card.isVisible().catch(() => false))) return seen;
    const title = await card.locator('.title').textContent();
    const options = card.locator('button');
    expect(await options.count()).toBeGreaterThanOrEqual(2);
    if (seen === 0) await shot(page, name);
    await expectNoVerticalOverflow(page, `moment ${title ?? ''}`);
    await options.first().click();
    seen++;
    await page.waitForTimeout(250);
  }
  return seen;
}

test('plays a full guard current run with moments, chips and headshots', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('quick-position-guard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('quick-era-current')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('quick-play')).toBeVisible();
  await expectNoVerticalOverflow(page, 'home');

  await page.getByTestId('quick-play').click();
  await expect(page.locator('.spin-big')).toBeVisible();

  await page.locator('.spin-big').click();
  const firstChip = page.locator('.chip').first();
  await firstChip.waitFor({ state: 'visible' });

  const chips = await page.locator('.chip').evaluateAll((nodes) =>
    nodes.map((node) => ({
      attr: node.getAttribute('data-attr'),
      val: Number(node.getAttribute('data-val')),
      disabled: (node as HTMLButtonElement).disabled,
      hasPhoto: Boolean(node.querySelector('img')),
      label: node.getAttribute('aria-label'),
    })),
  );
  expect(chips).toHaveLength(GUARD_KEYS.length);
  expect(chips.map((chip) => chip.attr)).toEqual(GUARD_KEYS);
  expect(chips.every((chip) => chip.val >= 0 && chip.val <= 11)).toBe(true);
  expect(chips.every((chip) => !chip.disabled)).toBe(true);
  expect(chips.some((chip) => chip.hasPhoto)).toBe(true);
  expect(chips[0]?.label).toContain('Jump Shot');

  const filledAttr = chips[0]?.attr ?? 'jumpShot';
  await firstChip.click();
  await expect(page.locator('.slot.filled')).toHaveCount(1);

  await page.locator('.spin-big').click();
  await page.locator('.chip').first().waitFor({ state: 'visible' });
  await expect(page.locator(`.chip[data-attr="${filledAttr}"]`)).toBeDisabled();
  await expect(page.locator('.chip:enabled')).toHaveCount(GUARD_KEYS.length - 1);
  await expect(page.locator('.slot-name').first()).toHaveText(/\S/);
  await shot(page, 'builder-with-picks');
  await expectNoVerticalOverflow(page, 'builder with picks');

  await page.locator('.chip:enabled').first().click();
  await expect(page.locator('.slot.filled')).toHaveCount(2);

  const grades = page.locator('.icon-btn.wide');
  await expect(grades).toHaveText('GRADES');
  await grades.click();
  await expect(grades).toHaveText('NUMBERS');
  await expect(page.locator('.slot.filled .slot-val').first()).toHaveText(/^\d+$/);
  await grades.click();
  await expect(page.locator('.slot.filled .slot-val').first()).toHaveText(/^[A-S][+-]?$/);

  for (let index = 2; index < 10; index++) {
    await spinAndPick(page);
  }

  await expect(page.locator('.slot.filled')).toHaveCount(10);
  await expect(page.getByText('All 10 slots filled.')).toBeVisible();
  await shot(page, 'build-complete');
  await expectNoVerticalOverflow(page, 'build complete');

  await page.getByRole('button', { name: 'Spin for Team' }).click();
  await page.locator('.spin-big').click();
  await expect(page.getByRole('button', { name: 'Simulate Season' })).toBeEnabled();
  await expect(page.locator('.card').filter({ hasText: /OFF \d+ · DEF \d+/ })).toBeVisible();

  await page.getByRole('button', { name: 'Simulate Season' }).click();
  await expect(page.getByText('Record')).toBeVisible();

  const momentsSeen = await answerMoments(page, 'moment');
  expect(momentsSeen).toBeGreaterThanOrEqual(1);
  const skip = page.getByRole('button', { name: 'Skip to Result' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.locator('.award').first()).toBeVisible();
  await expectNoVerticalOverflow(page, 'season result');

  const advance = page.locator('.bottom .btn');
  const label = (await advance.textContent()) ?? '';
  await advance.click();
  if (label.includes('Playoffs')) {
    await expect(page.getByRole('button', { name: 'Skip to Result' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip to Result' }).click();
    await expect(page.locator('.banner')).toBeVisible();
    await expectNoVerticalOverflow(page, 'playoffs');
    await page.getByRole('button', { name: 'See Results' }).click();
  }

  await expect(page.locator('[data-testid="ovr"]')).toBeVisible();
  await expect(page.locator('[data-testid="archetype"]')).not.toHaveText('Spin to start building');
  await expect(page.locator('[data-testid="ovr"]')).not.toHaveText('0');
  await expect(page.locator('.banner h1')).toHaveText(
    /NBA CHAMPIONS|LOST THE|OUT IN THE|MADE THE PLAYOFFS|MISSED THE PLAYOFFS/,
  );
  await shot(page, 'end-screen');
  await expectNoVerticalOverflow(page, 'end screen');
  console.log(`moments answered: ${momentsSeen}; advance label: ${label.trim()}`);
});

test('shows the no-slot state when a player has nothing left to give', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-play').click();
  await page.locator('.spin-big').click();
  await page.locator('.player-card').waitFor({ state: 'visible' });
  const playerName = (await page.locator('[data-testid="source-name"]').textContent())?.trim() ?? '';
  const teamLine = (await page.locator('[data-testid="source-team"]').textContent()) ?? '';
  const team = teamLine.split(' ')[0] ?? 'MIA';
  expect(playerName.length).toBeGreaterThan(2);

  const picks: Record<string, unknown> = {};
  for (const attr of GUARD_KEYS) {
    picks[attr] = { attr, val: 6, playerName: 'You', playerShort: 'You', team };
  }
  await page.addInitScript((run) => {
    localStorage.setItem('bab:v1', JSON.stringify(run));
  }, {
    v: 1,
    seed: 'b-e2e-noslot',
    position: 'guard',
    era: 'current',
    picks,
    spinIndex: 10,
    teamRespinUsed: false,
    playerRespinUsed: false,
    current: { team, playerName },
    team: null,
    season: null,
    draft: null,
    moment: null,
    screen: 'builder',
  });
  await page.goto('/');
  await expect(page.locator('[data-testid="no-slots"]')).toHaveText('No open slots for this player.');
  await expect(page.locator('.chip')).toHaveCount(GUARD_KEYS.length);
  await expect(page.locator('.chip:enabled')).toHaveCount(0);
  await expectNoVerticalOverflow(page, 'no free slot');
});

test('reveals the saved playoff bracket and the final report', async ({ page }) => {
  await page.addInitScript((run) => {
    localStorage.setItem('bab:v1', JSON.stringify(run));
  }, savedPlayoffRun());
  await page.goto('/');

  await expect(page.getByText('Record')).toBeVisible();
  await page.getByRole('button', { name: 'Skip to Result' }).click();
  await expect(page.locator('.award').first()).toBeVisible();
  await page.getByRole('button', { name: 'Enter Playoffs' }).click();

  await expect(page.getByRole('button', { name: 'Skip to Result' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip to Result' }).click();
  await expect(page.locator('.round')).toHaveCount(5);
  await expect(page.locator('.round').first()).toContainText('Play-In');
  await expect(page.locator('.round').last()).toContainText('NBA Finals');

  await page.getByRole('button', { name: 'See Results' }).click();
  await expect(page.locator('[data-testid="ovr"]')).toHaveText('88');
  await expect(page.locator('[data-testid="archetype"]')).not.toHaveText('Spin to start building');
  await expect(page.locator('[data-testid="outcome"] h1')).toHaveText('LOST THE NBA FINALS');
  await expect(page.locator('.award').filter({ hasText: 'GOAT' })).toContainText('#22 all-time');
  await expectNoVerticalOverflow(page, 'final report');
});

test('shows the multiplayer entry on the home screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="mp-home"]')).toBeVisible();
  await expect(page.getByTestId('home-career')).toHaveCount(0);
  await expect(page.locator('.home-item .lock')).toHaveCount(0);
  await expectNoVerticalOverflow(page, 'home modes');
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
    draft: null,
    moment: null,
    screen: 'season',
    season: {
      ovr: 88,
      archetype: 'Elite Scorer',
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
