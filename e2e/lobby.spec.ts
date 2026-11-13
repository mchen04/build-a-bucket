import { mkdirSync } from 'node:fs';
import { shotDir } from './shots';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { db } from '../src/server/db';
import { DEFAULT_REVEAL_SECONDS, MAX_ROUNDS } from '../src/shared/mp/types';
import { loadLocalEnv } from '../scripts/lib.ts';

const SHOTS = shotDir('lobby');
const PLAYERS = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fern', 'Gus', 'Hana'];
const PROFILE = devices['iPhone 14'];
const RELOADER = 3;
const createdCodes: string[] = [];

loadLocalEnv();
test.skip(!process.env.DATABASE_URL, 'the lobby spec needs the database');

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  if (!createdCodes.length) return;
  const removed = await db().query<{ id: string }>('delete from lobbies where code = any($1::text[]) returning id', [
    createdCodes,
  ]);
  const left = await db().query<{ count: string }>('select count(*)::text as count from lobbies where code = any($1::text[])', [
    createdCodes,
  ]);
  console.log(`e2e cleanup removed ${removed.length} lobbies, remaining ${left[0]?.count}`);
  expect(left[0]?.count).toBe('0');
});

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector('.app') as HTMLElement | null;
    const body = document.querySelector('.body') as HTMLElement | null;
    let spill = 0;
    if (body) {
      const insideScroller = (node: Element): boolean => {
        let parent = node.parentElement;
        while (parent && parent !== body) {
          const style = getComputedStyle(parent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            return true;
          }
          parent = parent.parentElement;
        }
        return false;
      };
      const limit = body.getBoundingClientRect().bottom;
      for (const node of Array.from(body.querySelectorAll('*'))) {
        const rect = node.getBoundingClientRect();
        if (rect.height === 0) continue;
        if (insideScroller(node)) continue;
        spill = Math.max(spill, rect.bottom - limit);
      }
    }
    return {
      document: root.scrollHeight - window.innerHeight,
      app: app ? app.scrollHeight - app.clientHeight : 0,
      spill,
    };
  });
  expect(overflow.document, `${label} scrolls vertically`).toBeLessThanOrEqual(1);
  expect(overflow.app, `${label} overflows its frame`).toBeLessThanOrEqual(1);
  expect(overflow.spill, `${label} spills under the action bar`).toBeLessThanOrEqual(1);
}

async function spinAndPick(page: Page): Promise<void> {
  const before = await page.locator('.slot.filled').count();
  await page.locator('.spin-big').click();
  const chips = page.locator('.chip:enabled');
  await chips.first().waitFor({ state: 'visible' });
  const values = await chips.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-val'))));
  await chips.nth(values.indexOf(Math.max(...values))).click();
  await expect(page.locator('.slot.filled')).toHaveCount(before + 1);
}

function mark(label: string, detail = ''): void {
  console.log(`[${new Date().toISOString()}] ${label}${detail ? ` ${detail}` : ''}`);
}

async function fillBuild(page: Page, remaining: number, label: string): Promise<void> {
  const spin = page.locator('.spin-big');
  if (!(await spin.isVisible().catch(() => false))) {
    mark(`${label} opens the builder`);
    await page.locator('[data-testid="open-builder"]').click();
  }
  await expect(page.locator('.spin-big')).toBeVisible();
  for (let pick = 0; pick < remaining; pick++) await spinAndPick(page);
  mark(`${label} filled ten slots`);
  await expect(page.locator('.slot.filled')).toHaveCount(10);
  await page.getByRole('button', { name: 'Spin for Team' }).click();
  mark(`${label} spins for a team`);
  await page.locator('.spin-big').click();
  await expect(page.getByRole('button', { name: 'Submit build' })).toBeEnabled();
}

async function finishBuild(page: Page, remaining: number, label: string): Promise<void> {
  await fillBuild(page, remaining, label);
  mark(`${label} submits`);
  await page.getByRole('button', { name: 'Submit build' }).click();
  await expect(page.locator('[data-testid="my-result"]')).toBeVisible({ timeout: 90_000 });
  mark(`${label} has a result`);
}

async function revealClock(page: Page): Promise<{ round: number; total: number } | null> {
  const label = (await page.locator('.bottom .btn').first().textContent().catch(() => null)) ?? '';
  const match = /Revealing round (\d+) of (\d+)/.exec(label);
  return match ? { round: Number(match[1]), total: Number(match[2]) } : null;
}

function readyToken(text: string): string {
  return /(\d+\/\d+ ready)/.exec(text)?.[1] ?? '';
}

async function ageLastSeen(code: string, seat: number, minutes: number): Promise<void> {
  await db().query(
    'update participants set last_seen = now() - make_interval(mins => $3::int) where lobby_id = (select id from lobbies where code = $1) and seat = $2',
    [code, seat, minutes],
  );
}

test('drives an eight player lobby from invite code to final standings', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const releaseCounts: number[] = PLAYERS.map(() => 0);
  let countingReleases = false;
  for (let index = 0; index < PLAYERS.length; index++) {
    const context = await browser.newContext({ ...PROFILE });
    contexts.push(context);
    const page = await context.newPage();
    page.on('request', (request) => {
      if (countingReleases && request.method() === 'POST' && request.url().includes('/release')) {
        releaseCounts[index] = (releaseCounts[index] ?? 0) + 1;
      }
    });
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(`[page ${index}] console error: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      console.log(`[page ${index}] request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        console.log(`[page ${index}] api ${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    pages.push(page);
  }

  try {
    const host = pages[0] as Page;
    await host.goto('/');
    await expectNoOverflow(host, 'home with the lobby entry');
    await host.locator('[data-testid="mp-name"]').fill(PLAYERS[0] as string);
    await host.locator('[data-testid="create-lobby"]').click();
    await expect(host.locator('[data-testid="lobby-code"]')).toBeVisible();
    const code = ((await host.locator('[data-testid="lobby-code"]').textContent()) ?? '').trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    createdCodes.push(code);
    mark('created lobby', code);

    await Promise.all(
      pages.slice(1).map(async (page, index) => {
        await page.goto('/');
        await page.locator('[data-testid="mp-name"]').fill(PLAYERS[index + 1] as string);
        await page.locator('[data-testid="mp-code"]').fill(code.toLowerCase());
        await page.locator('[data-testid="join-lobby"]').click();
        await expect(page.locator('[data-testid="lobby-code"]')).toBeVisible();
      }),
    );

    await expect(host.locator('[data-testid="roster"] .roster-row')).toHaveCount(8);
    mark('eight players joined');
    await expectNoOverflow(host, 'lobby with eight players');
    await host.screenshot({ path: `${SHOTS}/lobby-eight.png` });
    const guest = pages[1] as Page;
    await expectNoOverflow(guest, 'lobby for a guest');
    await guest.screenshot({ path: `${SHOTS}/lobby-guest.png` });

    await host.locator('[data-testid="start-season"]').click();
    await expect(host.locator('[data-testid="open-builder"]')).toBeVisible();
    await expect(guest.locator('[data-testid="open-builder"]')).toBeVisible();
    mark('season started');

    const reloader = pages[RELOADER] as Page;
    await reloader.locator('[data-testid="open-builder"]').click();
    for (let pick = 0; pick < 4; pick++) await spinAndPick(reloader);
    await expect(reloader.locator('.slot.filled')).toHaveCount(4);
    mark('reloader placed four picks');
    await expectNoOverflow(reloader, 'builder with the roster panel');

    const peer = pages[2] as Page;
    const pickStarted = Date.now();
    await spinAndPick(reloader);
    await expect
      .poll(async () => (await peer.locator('[data-testid="activity-ticker"]').textContent()) ?? '', {
        timeout: 8000,
        intervals: [100],
      })
      .toContain(`${PLAYERS[RELOADER]} took`);
    const pickLatency = Date.now() - pickStarted;
    expect(pickLatency, 'a peer sees a pick within 2.5s').toBeLessThan(2500);
    mark('peer saw the pick', `${pickLatency}ms`);
    await expect(peer.locator('.roster-row', { hasText: PLAYERS[RELOADER] as string })).toContainText('/10');
    await peer.locator('[data-testid="open-builder"]').click();
    await expect(peer.locator('[data-testid="peer-strip"] .peer', { hasText: PLAYERS[RELOADER] as string })).toContainText(
      '/10',
    );
    await expectNoOverflow(peer, 'builder while a peer is building');
    await peer.screenshot({ path: `${SHOTS}/build-with-roster.png` });
    await reloader.screenshot({ path: `${SHOTS}/build-own-board.png` });

    await reloader.waitForTimeout(1500);
    await reloader.reload();
    await expect(reloader.locator('[data-testid="open-builder"]')).toHaveText(/Continue build · 5\/10/, { timeout: 30_000 });
    mark('reloader resumed five picks');
    await reloader.locator('[data-testid="open-builder"]').click();
    await expect(reloader.locator('.slot.filled')).toHaveCount(5);

    countingReleases = true;
    mark('all players build');
    await Promise.all(pages.map((page, index) => finishBuild(page, index === RELOADER ? 5 : 10, PLAYERS[index] as string)));
    mark('every build submitted');

    await expect(host.locator('[data-testid="my-result"]')).toBeVisible({ timeout: 60_000 });
    const barrier = pages[2] as Page;
    await expect(barrier.locator('[data-testid="barrier-state"]')).toContainText(/\d+\/\d+ ready/, {
      timeout: 60_000,
    });
    const barrierReady = readyToken((await barrier.locator('[data-testid="barrier-state"]').textContent()) ?? '');
    expect(barrierReady).toBe('8/8 ready');
    await expectNoOverflow(barrier, 'barrier');
    await barrier.screenshot({ path: `${SHOTS}/barrier.png` });

    await expect(host.locator('[data-testid="lobby-status"]')).toHaveText('Playoffs', { timeout: 60_000 });
    await expect(host.locator('[data-testid="next-reveal"]')).toBeVisible();
    await expectNoOverflow(host, 'playoff reveal');
    const revealText = ((await host.locator('.body').innerText()) ?? '').toLowerCase();
    expect(revealText, 'no final finish label at the first reveal').not.toContain('finals loss');
    expect(revealText, 'no semi final label at the first reveal').not.toContain('semis');
    expect(revealText, 'no champion at the first reveal').not.toContain('champion');
    await host.screenshot({ path: `${SHOTS}/playoff-reveal.png` });

    const revealMs = DEFAULT_REVEAL_SECONDS * 1000;
    const firstSeen: Array<Map<number, number>> = pages.map(() => new Map());
    const totals = new Set<number>();
    const watchStarted = Date.now();
    while (Date.now() - watchStarted < 90_000) {
      const clocks = await Promise.all(pages.map((page) => revealClock(page)));
      clocks.forEach((clock, index) => {
        if (!clock) return;
        totals.add(clock.total);
        const timeline = firstSeen[index] as Map<number, number>;
        if (!timeline.has(clock.round)) timeline.set(clock.round, Date.now() - watchStarted);
      });
      if (await host.locator('[data-testid="standings"]').isVisible()) break;
      await host.waitForTimeout(250);
    }
    expect(totals.size, 'every page reads the same lobby round count').toBe(1);
    const lobbyRounds = [...totals][0] as number;
    expect(lobbyRounds, 'the lobby countdown is the fixed playoff length').toBe(MAX_ROUNDS);
    const clockRounds = MAX_ROUNDS - 1;
    firstSeen.forEach((timeline, index) => {
      expect([...timeline.keys()].sort((a, b) => a - b), `page ${index} watched rounds 1..${clockRounds} in order`).toEqual(
        Array.from({ length: clockRounds }, (_, step) => step + 1),
      );
    });
    for (let round = 1; round <= clockRounds; round++) {
      const times = firstSeen.map((timeline) => timeline.get(round) ?? -1);
      expect(Math.min(...times), `every page saw round ${round}`).toBeGreaterThanOrEqual(0);
      expect(
        Math.max(...times) - Math.min(...times),
        `round ${round} reached every page inside one reveal interval`,
      ).toBeLessThanOrEqual(revealMs);
    }

    await expect(host.locator('[data-testid="standings"]')).toBeVisible({ timeout: 90_000 });
    await expect(host.locator('[data-testid="standings"] .table-row')).toHaveCount(9);
    expect(readyToken((await host.locator('[data-testid="barrier-state"]').textContent()) ?? '')).toBe(barrierReady);
    const champions = await host.locator('.peer.champ').count();
    expect(await host.locator('[data-testid="standings"] .table-row', { hasText: 'Champion' }).count()).toBe(champions);
    mark('champions in this lobby', String(champions));
    await expectNoOverflow(host, 'final standings');
    await host.screenshot({ path: `${SHOTS}/standings.png` });
    const fifth = pages[5] as Page;
    await expect(fifth.locator('[data-testid="standings"]')).toBeVisible({ timeout: 30_000 });
    await expectNoOverflow(fifth, 'final standings for a guest');
    await fifth.screenshot({ path: `${SHOTS}/standings-guest.png` });

    const standings = await host.locator('[data-testid="standings"] .table-row').allTextContents();
    console.log(`standings:\n${standings.join('\n')}`);
    console.log(`rounds seen per page: ${firstSeen.map((timeline) => [...timeline.keys()].sort().join('/')).join(' | ')}`);
    console.log(`release attempts per page: ${releaseCounts.join(', ')}`);
    for (const [index, count] of releaseCounts.entries()) {
      expect(count, `page ${index} stops asking for a release while the barrier holds`).toBeLessThanOrEqual(3);
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('lets a returning player finish at the barrier and starts the playoffs', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts: BrowserContext[] = [];
  const hostContext = await browser.newContext({ ...PROFILE });
  const guestContext = await browser.newContext({ ...PROFILE });
  contexts.push(hostContext, guestContext);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await host.locator('[data-testid="mp-name"]').fill('Ava');
    await host.locator('[data-testid="create-lobby"]').click();
    await expect(host.locator('[data-testid="lobby-code"]')).toBeVisible();
    const code = ((await host.locator('[data-testid="lobby-code"]').textContent()) ?? '').trim();
    createdCodes.push(code);

    await guest.goto('/');
    await guest.locator('[data-testid="mp-name"]').fill('Ben');
    await guest.locator('[data-testid="mp-code"]').fill(code);
    await guest.locator('[data-testid="join-lobby"]').click();
    await expect(guest.locator('[data-testid="lobby-code"]')).toBeVisible();

    await host.locator('[data-testid="start-season"]').click();
    await expect(host.locator('[data-testid="open-builder"]')).toBeVisible();
    await expect(guest.locator('[data-testid="open-builder"]')).toBeVisible();

    await host.locator('[data-testid="open-builder"]').click();
    await spinAndPick(host);
    await guest.locator('[data-testid="open-builder"]').click();
    await spinAndPick(guest);
    await expect(host.locator('[data-testid="peer-strip"] .peer', { hasText: 'Ben' })).toContainText('1/10', {
      timeout: 15_000,
    });

    // Hold the host's release requests so the barrier stays open while the
    // guest is away; the guest's own return is what the test waits on.
    await host.route('**/api/lobby/*/release', async (route) => {
      const force = (route.request().postData() ?? '').includes('"force":true');
      if (force) return route.continue();
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The barrier is held for this test.', reason: 'conflict' }),
      });
    });

    await guest.goto('about:blank');
    await ageLastSeen(code, 2, 5);
    await finishBuild(host, 9, 'Ava');
    await expect(host.locator('[data-testid="barrier-state"]')).toContainText(/ready/, { timeout: 30_000 });
    await host.screenshot({ path: `${SHOTS}/barrier-return-host.png` });

    await guest.goto('/');
    await expect(guest.locator('[data-testid="lobby-status"]')).toHaveText('Barrier', { timeout: 30_000 });
    await expect(guest.locator('[data-testid="open-builder"]')).toBeVisible({ timeout: 30_000 });
    await guest.screenshot({ path: `${SHOTS}/barrier-return-guest.png` });

    await finishBuild(guest, 9, 'Ben');
    await expect(guest.locator('[data-testid="my-result"]')).toBeVisible({ timeout: 60_000 });
    await expect(guest.getByText('The playoffs have already started.')).toHaveCount(0);
    expect((await guest.locator('[data-testid="my-result"]').textContent()) ?? '').toMatch(/in the playoffs|· out/);
    await expect(guest.locator('[data-testid="lobby-status"]')).toHaveText('Playoffs', { timeout: 60_000 });
    await guest.screenshot({ path: `${SHOTS}/barrier-return-playoffs.png` });

    await expect(host.locator('[data-testid="lobby-status"]')).toHaveText('Playoffs', { timeout: 60_000 });
    await expect(host.locator('[data-testid="next-reveal"]')).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('keeps a lobby pick through an immediate reload', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts: BrowserContext[] = [];
  const hostContext = await browser.newContext({ ...PROFILE });
  const guestContext = await browser.newContext({ ...PROFILE });
  contexts.push(hostContext, guestContext);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await host.locator('[data-testid="mp-name"]').fill('Ava');
    await host.locator('[data-testid="create-lobby"]').click();
    await expect(host.locator('[data-testid="lobby-code"]')).toBeVisible();
    const code = ((await host.locator('[data-testid="lobby-code"]').textContent()) ?? '').trim();
    createdCodes.push(code);

    await guest.goto('/');
    await guest.locator('[data-testid="mp-name"]').fill('Ben');
    await guest.locator('[data-testid="mp-code"]').fill(code);
    await guest.locator('[data-testid="join-lobby"]').click();
    await expect(guest.locator('[data-testid="lobby-code"]')).toBeVisible();

    await host.locator('[data-testid="start-season"]').click();
    await expect(guest.locator('[data-testid="open-builder"]')).toBeVisible();
    await guest.locator('[data-testid="open-builder"]').click();
    await spinAndPick(guest);
    await guest.reload();
    await expect(guest.locator('[data-testid="open-builder"]')).toContainText('Continue build · 1/10');
    await expect(host.locator('[data-testid="roster"] [data-seat="2"] .state')).toContainText('1/10', {
      timeout: 15_000,
    });
    await guest.locator('[data-testid="open-builder"]').click();
    await expect(guest.locator('.slot.filled')).toHaveCount(1);

    await fillBuild(guest, 9, 'Ben');
    await guest.getByRole('button', { name: 'Submit build' }).click();
    await expect(guest.locator('[data-testid="my-result"]')).toBeVisible({ timeout: 90_000 });
    await expect(guest.locator('[data-testid="open-builder"]')).toHaveCount(0);
    await expect.poll(() => guest.evaluate(() => localStorage.getItem('bab:mp:draft:v1'))).toBeNull();

    await guest.reload();
    await expect(guest.locator('[data-testid="my-result"]')).toBeVisible({ timeout: 30_000 });
    await expect(guest.locator('[data-testid="open-builder"]')).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('a submit after the host starts the playoffs lands on the lobby with a message', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts: BrowserContext[] = [];
  const hostContext = await browser.newContext({ ...PROFILE });
  const awayContext = await browser.newContext({ ...PROFILE });
  const backContext = await browser.newContext({ ...PROFILE });
  contexts.push(hostContext, awayContext, backContext);
  const host = await hostContext.newPage();
  const away = await awayContext.newPage();
  let back = await backContext.newPage();
  try {
    await host.goto('/');
    await host.locator('[data-testid="mp-name"]').fill('Hana');
    await host.locator('[data-testid="create-lobby"]').click();
    await expect(host.locator('[data-testid="lobby-code"]')).toBeVisible();
    const code = ((await host.locator('[data-testid="lobby-code"]').textContent()) ?? '').trim();
    createdCodes.push(code);

    for (const [page, name] of [[away, 'Xena'], [back, 'Ravi']] as const) {
      await page.goto('/');
      await page.locator('[data-testid="mp-name"]').fill(name);
      await page.locator('[data-testid="mp-code"]').fill(code);
      await page.locator('[data-testid="join-lobby"]').click();
      await expect(page.locator('[data-testid="lobby-code"]')).toBeVisible();
    }

    await host.locator('[data-testid="start-season"]').click();
    await expect(host.locator('[data-testid="open-builder"]')).toBeVisible();
    await expect(back.locator('[data-testid="open-builder"]')).toBeVisible();
    await fillBuild(host, 10, 'Hana');
    await fillBuild(back, 10, 'Ravi');

    // The host keeps the barrier open until it taps Start playoffs now; the
    // returner gets back before the barrier can release on its own.
    await host.route('**/api/lobby/*/release', async (route) => {
      const force = (route.request().postData() ?? '').includes('"force":true');
      if (force) return route.continue();
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The barrier is held for this test.', reason: 'conflict' }),
      });
    });

    await away.goto('about:blank');
    await ageLastSeen(code, 2, 5);
    await back.close();
    await host.getByRole('button', { name: 'Submit build' }).click();
    await expect(host.locator('[data-testid="my-result"]')).toBeVisible({ timeout: 90_000 });
    await ageLastSeen(code, 3, 5);
    await expect(host.locator('[data-testid="barrier-state"]')).toBeVisible({ timeout: 30_000 });

    back = await backContext.newPage();
    await back.goto('/');
    await expect(back.locator('[data-testid="open-builder"]')).toContainText('Spin for team', { timeout: 30_000 });
    await back.locator('[data-testid="open-builder"]').click();
    const spinForTeam = back.getByRole('button', { name: 'Spin for Team' });
    if (await spinForTeam.isVisible().catch(() => false)) await spinForTeam.click();
    const submit = back.getByRole('button', { name: 'Submit build' });
    await expect(submit).toBeEnabled();

    await expect(host.locator('[data-testid="force-playoffs"]')).toBeVisible({ timeout: 30_000 });
    await host.getByTestId('force-playoffs').click();
    await expect(host.locator('[data-testid="lobby-status"]')).toHaveText('Playoffs', { timeout: 30_000 });

    await submit.click();
    await expect(back.getByText('The playoffs have already started.')).toBeVisible({ timeout: 30_000 });
    await expect(back.locator('[data-testid="lobby-status"]')).toHaveText('Playoffs', { timeout: 30_000 });
    await expect(back.getByText('Spectating')).toBeVisible({ timeout: 30_000 });
    await expect(back.locator('[data-testid="open-builder"]')).toHaveCount(0);
    await back.screenshot({ path: `${SHOTS}/playoffs-submit-refused.png` });
  } finally {
    for (const context of contexts) await context.close();
  }
});
