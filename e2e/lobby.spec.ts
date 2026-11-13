import { mkdirSync } from 'node:fs';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { db } from '../src/server/db';
import { DEFAULT_REVEAL_SECONDS } from '../src/shared/mp/types';
import { loadLocalEnv } from '../scripts/lib.ts';

const SHOTS = '/Users/michaelchen/Work/build-a-bucket-t_614e29cd/after/turn2';
const PLAYERS = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fern', 'Gus', 'Hana'];
const PROFILE = devices['iPhone 14'];
const RELOADER = 3;
const createdCodes: string[] = [];

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  if (!createdCodes.length) return;
  loadLocalEnv();
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
  const chip = page.locator('.chip:enabled').first();
  await chip.waitFor({ state: 'visible' });
  await chip.click();
  await expect(page.locator('.slot.filled')).toHaveCount(before + 1);
}

function mark(label: string, detail = ''): void {
  console.log(`[${new Date().toISOString()}] ${label}${detail ? ` ${detail}` : ''}`);
}

async function finishBuild(page: Page, remaining: number, label: string): Promise<void> {
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
  const submit = page.getByRole('button', { name: 'Submit build' });
  await expect(submit).toBeEnabled();
  mark(`${label} submits`);
  await submit.click();
  await expect(page.locator('[data-testid="my-result"]')).toBeVisible({ timeout: 90_000 });
  mark(`${label} has a result`);
}

async function revealRound(page: Page): Promise<number | null> {
  const label = (await page.locator('.bottom .btn').first().textContent().catch(() => null)) ?? '';
  const match = /Revealing round (\d+) of (\d+)/.exec(label);
  return match ? Number(match[1]) : null;
}

function readyToken(text: string): string {
  return /(\d+\/\d+ ready)/.exec(text)?.[1] ?? '';
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
    const watchStarted = Date.now();
    while (Date.now() - watchStarted < 90_000) {
      const seen = await Promise.all(pages.map((page) => revealRound(page)));
      seen.forEach((round, index) => {
        const timeline = firstSeen[index] as Map<number, number>;
        if (round !== null && !timeline.has(round)) timeline.set(round, Date.now() - watchStarted);
      });
      if (await host.locator('[data-testid="standings"]').isVisible()) break;
      await host.waitForTimeout(250);
    }
    const roundsTotal = Math.max(...firstSeen.map((timeline) => Math.max(...timeline.keys())));
    expect(roundsTotal, 'the reveal clock shows every round the lobby has').toBeGreaterThanOrEqual(3);
    firstSeen.forEach((timeline, index) => {
      const seen = [...timeline.keys()].sort((a, b) => a - b);
      expect(seen, `page ${index} watched rounds 1..${roundsTotal} in order`).toEqual(
        Array.from({ length: roundsTotal }, (_, step) => step + 1),
      );
    });
    for (let round = 1; round <= roundsTotal; round++) {
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
