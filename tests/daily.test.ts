import { describe, expect, it } from 'vitest';
import { DAILY_EPOCH, dayNumber, dailyPlanFor, newYorkDayKey, type DailyPlan } from '../src/shared/engine/daily';
import { spinTarget } from '../src/shared/engine/spin';
import { GOLDEN_DAILY, GOLDEN_DAILY_SPINS } from './fixtures/golden';
import { SAL_GUARDS } from './fixtures/modes';

describe('daily challenge plan', () => {
  it('matches the traced day mapping', () => {
    for (const expected of GOLDEN_DAILY) {
      const plan = dailyPlanFor(expected.key);
      expect({ key: plan.key, sport: plan.sport, pos: plan.pos, mode: plan.mode, seed: plan.seed }).toEqual(expected);
    }
  });

  it('alternates basketball and football from the epoch', () => {
    const epoch = dayNumber(DAILY_EPOCH);
    const first: DailyPlan = dailyPlanFor('2026-10-24');
    const second: DailyPlan = dailyPlanFor('2026-10-25');
    const third: DailyPlan = dailyPlanFor('2026-10-26');
    expect(first.sport).toBe('bucket');
    expect(first.pos).toBe('guard');
    expect(second.sport).toBe('nfl');
    expect(third.sport).toBe('bucket');
    expect(third.pos).toBe('big');
    expect(dayNumber('2026-10-24') - epoch).toBe(1);
  });

  it('switches era every two basketball days', () => {
    const days = ['2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30'].map((key) => dailyPlanFor(key));
    expect(days.map((plan) => plan.mode)).toEqual(['classic', 'classic', 'all-time', 'all-time']);
    expect(days.map((plan) => plan.pos)).toEqual(['guard', 'big', 'guard', 'big']);
  });

  it('keys the day in New York time', () => {
    expect(newYorkDayKey(new Date('2026-11-14T03:30:00Z'))).toBe('2026-11-13');
    expect(newYorkDayKey(new Date('2026-11-14T06:30:00Z'))).toBe('2026-11-14');
  });

  it('seeds the plan with the day', () => {
    expect(dailyPlanFor('2026-11-13').seed).toBe('bap-daily-2026-11-13');
  });
});

describe('daily spins', () => {
  it('deals the traced shared spins for the day seed', () => {
    const plan = dailyPlanFor('2026-11-13');
    for (const expected of GOLDEN_DAILY_SPINS) {
      const target = spinTarget(SAL_GUARDS, plan.seed, expected.index, false, 0, `${plan.seed}:r`);
      expect(target?.team).toBe(expected.team);
      expect(target?.player.name).toBe(expected.player);
    }
  });

  it('is stable across calls', () => {
    const plan = dailyPlanFor('2026-11-13');
    const first = spinTarget(SAL_GUARDS, plan.seed, 1, false, 0, `${plan.seed}:r`);
    const second = spinTarget(SAL_GUARDS, plan.seed, 1, false, 0, `${plan.seed}:r`);
    expect(second?.player.name).toBe(first?.player.name);
  });
});
