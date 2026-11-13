import { mkdirSync } from 'node:fs';
import { shotDir } from './shots';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = shotDir('career');

test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function expectSentenceLines(page: Page, testId: string, label: string): Promise<void> {
  const line = page.getByTestId(testId).locator('.line').first();
  await expect(line, `${label} must render its sentences`).toBeVisible();
  const style = await line.evaluate((el) => {
    const computed = getComputedStyle(el);
    return { transform: computed.textTransform, size: computed.fontSize };
  });
  expect(style.transform, `${label} sentences must keep normal case`).toBe('none');
  expect(style.size, `${label} sentences must not use the 11px label size`).not.toBe('11px');
}

async function expectHonestPostseasonTag(page: Page, label: string): Promise<void> {
  const text = await page.getByTestId('career-recap').innerText();
  const record = /(\d+)-(\d+)/.exec(text);
  expect(record, `${label} must show a record`).not.toBeNull();
  const wins = Number(record?.[1]);
  if (wins < 40) {
    expect(text, `${label} tagged a ${wins}-win season as playoffs`).not.toContain('PLAYOFFS');
    expect(text, `${label} tagged a ${wins}-win season as a play-in`).not.toContain('PLAY-IN');
  }
  if (text.includes('PLAY-IN')) expect(wins).toBeGreaterThanOrEqual(40);
  if (text.includes('CHAMPIONS')) expect(wins).toBeGreaterThanOrEqual(40);
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

const visible = async (page: Page, id: string) => page.getByTestId(id).isVisible().catch(() => false);

async function expectSeasonUi(page: Page): Promise<void> {
  await expect(
    page.locator('[data-testid="career-season"], [data-testid="career-injury"], [data-testid="career-bracket"]').first(),
  ).toBeVisible();
}

async function playSeason(page: Page): Promise<void> {
  for (let guard = 0; guard < 90; guard++) {
    if (await visible(page, 'career-advance')) {
      await page.getByTestId('career-advance').click();
      continue;
    }
    if (await visible(page, 'career-sit')) {
      await page.getByTestId('career-sit').click();
      continue;
    }
    if (await visible(page, 'career-play-through')) {
      await page.getByTestId('career-play-through').click();
      continue;
    }
    if (await visible(page, 'career-round')) {
      await page.getByTestId('career-round').click();
      continue;
    }
    break;
  }
}

async function leaveOffseason(page: Page): Promise<boolean> {
  for (let guard = 0; guard < 12; guard++) {
    if (await visible(page, 'career-camp-run')) {
      await page.getByTestId('career-camp-run').click();
      continue;
    }
    if (await visible(page, 'career-off-next')) {
      await page.getByTestId('career-off-next').click();
      return true;
    }
    if (await visible(page, 'career-off-sign')) {
      await page.getByTestId('career-off-sign').click();
      const stay = page.getByTestId('career-offer-stay');
      if (await stay.isVisible().catch(() => false)) {
        await stay.getByRole('button', { name: 'Sign' }).click();
        continue;
      }
      const talks = page.getByTestId('career-talks');
      if (await talks.isVisible().catch(() => false)) {
        await page.getByTestId('career-accept').click();
        continue;
      }
    }
    if (await visible(page, 'career-off-retire')) {
      await page.getByTestId('career-off-retire').click();
      return false;
    }
    break;
  }
  return false;
}

test('plays a career from creation through seasons to retirement', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await page.getByTestId('home-career').click();
  await expect(page.getByTestId('career-slots')).toBeVisible();
  await expectNoVerticalOverflow(page, 'career slots');
  await shot(page, 'career-slots');

  await page.getByTestId('career-new').click();
  await page.getByTestId('career-first').fill('Ada');
  await page.getByTestId('career-last').fill('Vance');
  await page.getByTestId('career-games-off').click();
  await expectNoVerticalOverflow(page, 'career form');
  await shot(page, 'career-form');
  await page.getByTestId('career-start').click();

  for (let index = 0; index < 10; index++) await spinAndPick(page);
  await page.getByRole('button', { name: 'Enter the draft' }).click();

  await expect(page.getByTestId('career-combine')).toBeVisible();
  for (const id of ['sprint', 'lane', 'spot']) await page.getByTestId(`career-drill-${id}`).click();
  await expectNoVerticalOverflow(page, 'career combine');
  await shot(page, 'career-combine');
  await page.getByTestId('career-combine-done').click();

  await expect(page.getByTestId('career-interviews')).toBeVisible();
  for (let index = 0; index < 4; index++) await page.getByTestId(`career-answer-${index}-0`).click();
  await expectNoVerticalOverflow(page, 'career interviews');
  await shot(page, 'career-interviews');
  await page.getByTestId('career-interviews-done').click();

  await expect(page.getByTestId('career-pick')).toBeVisible();
  await expectNoVerticalOverflow(page, 'career draft day');
  await shot(page, 'career-draftday');
  await page.getByTestId('career-sign').click();

  await expect(page.getByTestId('career-preseason')).toBeVisible();
  await expectNoVerticalOverflow(page, 'career preseason');
  await shot(page, 'career-preseason');
  await page.getByTestId('career-tipoff').click();
  await expect(page.getByTestId('career-season')).toBeVisible();
  await expectNoVerticalOverflow(page, 'career season');

  await page.getByTestId('career-advance').click();
  await expectSeasonUi(page);

  await page.reload();
  await page.getByTestId('home-career').click();
  await page.getByTestId('career-slot-0').getByRole('button', { name: 'Resume' }).click();
  await expectSeasonUi(page);
  await shot(page, 'career-resumed');

  await playSeason(page);
  await expect(page.getByTestId('career-recap')).toBeVisible();
  await expectHonestPostseasonTag(page, 'career recap');
  await expectSentenceLines(page, 'career-news', 'career news');
  await expectNoVerticalOverflow(page, 'career recap');
  await shot(page, 'career-recap');

  let seasons = 1;
  while (seasons < 12) {
    const advanced = await leaveOffseason(page);
    if (!advanced) break;
    await expect(page.getByTestId('career-preseason')).toBeVisible();
    await page.getByTestId('career-tab-career').click();
    await expectSentenceLines(page, 'career-decisions', 'career decisions');
    if (await visible(page, 'career-retire')) {
      await shot(page, 'career-totals');
      await expectNoVerticalOverflow(page, 'career totals');
      await page.getByTestId('career-retire').click();
      break;
    }
    await page.getByTestId('career-tab-season').click();
    await page.getByTestId('career-tipoff').click();
    await playSeason(page);
    await expectHonestPostseasonTag(page, `season ${seasons + 1}`);
    seasons++;
  }

  await expect(page.getByTestId('career-retired')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('career-hof')).toBeVisible();
  await expectNoVerticalOverflow(page, 'career retired');
  await shot(page, 'career-retired');

  await shot(page, 'career-legacy');

  await page.getByRole('button', { name: 'Back to the slots' }).click();
  await expect(page.getByTestId('career-history')).toBeVisible();
  await expect(page.getByTestId('career-history')).toContainText('Ada Vance');
  await shot(page, 'career-history');
  expect(seasons).toBeGreaterThanOrEqual(2);
});
