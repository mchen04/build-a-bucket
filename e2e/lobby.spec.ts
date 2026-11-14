import { mkdirSync } from 'node:fs';
import { shotDir } from './shots';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { db } from '../src/server/db';
import type { LeagueResult } from '../src/shared/engine/league';
import { stageTotal } from '../src/shared/mp/league';
import { loadLocalEnv } from '../scripts/lib.ts';

const SHOTS = shotDir('lobby');
const PROFILE = devices['iPhone 14'];
const createdCodes: string[] = [];

loadLocalEnv();
test.skip(!process.env.DATABASE_URL, 'the lobby spec needs the database');

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  if (!createdCodes.length) return;
  await db().query('delete from lobbies where code = any($1::text[])', [createdCodes]);
  const left = await db().query<{ count: string }>('select count(*)::text as count from lobbies where code = any($1::text[])', [
    createdCodes,
  ]);
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
        let parent: Element | null = node.parentElement;
        while (parent) {
          const style = getComputedStyle(parent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') return true;
          if (parent === body) break;
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
    return { document: root.scrollHeight - window.innerHeight, app: app ? app.scrollHeight - app.clientHeight : 0, spill };
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

async function buildAndSubmit(page: Page): Promise<void> {
  await page.locator('[data-testid="open-builder"]').click();
  await expect(page.locator('.spin-big')).toBeVisible();
  for (let pick = 0; pick < 10; pick++) await spinAndPick(page);
  await expect(page.locator('.slot.filled')).toHaveCount(10);
  await page.getByRole('button', { name: 'Submit build' }).click();
  await expect(page.getByTestId('building-state').or(page.getByTestId('preview-ready'))).toBeVisible({
    timeout: 30_000,
  });
}

async function fastForward(code: string): Promise<void> {
  const rows = await db().query<{ id: string; stage: number; league: unknown }>('select id, stage, league from lobbies where code = $1', [
    code,
  ]);
  const row = rows[0];
  if (!row) throw new Error('lobby missing');
  const total = stageTotal(row.league as LeagueResult, row.stage);
  await db().query(
    "update lobbies set stage_started_at = now() - interval '1 hour', stage_cursor = $2, version = version + 1 where id = $1::uuid",
    [row.id, total],
  );
}

test('drives a two player shared league from invite code to recap', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts: BrowserContext[] = [];
  const hostContext = await browser.newContext({ ...PROFILE });
  const guestContext = await browser.newContext({ ...PROFILE });
  contexts.push(hostContext, guestContext);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await expectNoOverflow(host, 'home with the lobby entry');
    await host.locator('[data-testid="mp-name"]').fill('Ava');
    await host.locator('[data-testid="create-lobby"]').click();
    await expect(host.locator('[data-testid="lobby-code"]')).toBeVisible();
    const code = ((await host.locator('[data-testid="lobby-code"]').textContent()) ?? '').trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    createdCodes.push(code);

    await guest.goto('/');
    await guest.locator('[data-testid="mp-name"]').fill('Ben');
    await guest.locator('[data-testid="mp-code"]').fill(code.toLowerCase());
    await guest.locator('[data-testid="join-lobby"]').click();
    await expect(guest.locator('[data-testid="lobby-code"]')).toBeVisible();
    await expect(host.locator('[data-testid="roster"] .roster-row[data-seat]')).toHaveCount(2);
    await expectNoOverflow(host, 'lobby with two players');

    await host.locator('[data-testid="start-season"]').click();
    await expect(host.locator('[data-testid="draw-team"]')).toBeVisible();
    await expect(guest.locator('[data-testid="draw-team"]')).toBeVisible();

    await host.locator('[data-testid="draw-team"]').click();
    await expect(host.locator('[data-testid="reroll-team"]')).toBeVisible();
    await host.locator('[data-testid="reroll-team"]').click();
    await guest.locator('[data-testid="draw-team"]').click();
    await expectNoOverflow(host, 'team draw');

    await expect(host.locator('[data-testid="open-builder"]')).toBeVisible({ timeout: 30_000 });
    await expect(guest.locator('[data-testid="open-builder"]')).toBeVisible({ timeout: 30_000 });

    await buildAndSubmit(host);
    await buildAndSubmit(guest);
    await expect(host.locator('[data-testid="preview-ready"]')).toBeVisible({ timeout: 30_000 });
    await expect(guest.locator('[data-testid="preview-ready"]')).toBeVisible({ timeout: 30_000 });
    await expectNoOverflow(host, 'team preview');

    await host.locator('[data-testid="preview-ready"]').click();
    await guest.locator('[data-testid="preview-ready"]').click();
    await expect(host.locator('[data-testid="league-stage"]')).toBeVisible({ timeout: 30_000 });
    await expect(host.locator('[data-testid="lobby-status"]')).toHaveText('Season running');
    await expect(host.locator('[data-testid="awards"]')).toHaveCount(0);
    await expect(host.locator('[data-testid="playoffs"]')).toHaveCount(0);
    await expect(host.locator('[data-testid="recap"]')).toHaveCount(0);
    await expectNoOverflow(host, 'season reveal');

    for (let guard = 0; guard < 12; guard++) {
      if (await host.locator('[data-testid="recap"]').isVisible().catch(() => false)) break;
      await fastForward(code);
      const ready = host.getByRole('button', { name: 'Ready' });
      const recap = host.locator('[data-testid="recap"]');
      const deadline = Date.now() + 30_000;
      let state: 'ready' | 'recap' | null = null;
      while (Date.now() < deadline) {
        if (await recap.isVisible().catch(() => false)) {
          state = 'recap';
          break;
        }
        if ((await ready.isVisible().catch(() => false)) && (await ready.isEnabled().catch(() => false))) {
          state = 'ready';
          break;
        }
        await host.waitForTimeout(200);
      }
      if (state === 'recap') break;
      if (state !== 'ready') throw new Error('neither the checkpoint Ready button nor the recap appeared');
      await ready.click();
      const guestReady = guest.getByRole('button', { name: 'Ready' });
      await expect(guestReady).toBeEnabled({ timeout: 30_000 });
      await guestReady.click();
      await host.waitForTimeout(500);
    }

    await expect(host.locator('[data-testid="recap"]')).toBeVisible({ timeout: 60_000 });
    await expect(host.locator('[data-testid="champion-banner"]')).toBeVisible();
    await expect(host.locator('[data-testid="recap"]')).toContainText('Head to head');
    await expectNoOverflow(host, 'recap');
    await host.screenshot({ path: `${SHOTS}/recap.png` });

    await host.locator('[data-testid="rematch"]').click();
    await expect(host.getByTestId('rematch-ready')).toBeVisible({ timeout: 30_000 });
    await host.getByTestId('rematch-ready').click();
    await guest.getByTestId('rematch-ready').click();
    await expect(host.locator('[data-testid="draw-team"]')).toBeVisible({ timeout: 30_000 });
    await expect(host.locator('.top-title')).toHaveText(`Lobby ${code}`);
    await expect(host.locator('[data-testid="roster"] .roster-row[data-seat]')).toHaveCount(2);
  } finally {
    for (const context of contexts) await context.close();
  }
});
