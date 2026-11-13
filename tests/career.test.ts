import { describe, expect, it } from 'vitest';
import golden from './fixtures/career-golden.json';
import {
  buildBracket,
  bestOf7,
  bucketRoundOdds,
  closeChance,
  draftOrder,
  drillValue,
  gameOf,
  hashN,
  injuryRoll,
  makeRoster,
  runDraft,
  seasonSwing,
  seriesPlay,
  seriesState,
  stockOf,
  teamFit,
  type Career,
  type CareerTeam,
  type Ctx,
  type Injury,
  type Roster,
  type RosterPlayer,
} from '../src/shared/engine/career/core';
import { newCareer, advance, startSeason, resolveInjury, playRound, nextSeason, retire, legacyOf, careerTotals, hofProgress, retireReason } from '../src/shared/engine/career/engine';
import { rookieDeal } from '../src/shared/engine/career/rules';

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

function attrsFor(pos: 'guard' | 'big', ovr: number): Record<string, number> {
  const v = 1 + (9 * (ovr - 57)) / 44;
  return Object.fromEntries((pos === 'guard' ? GUARD_KEYS : BIG_KEYS).map((k) => [k, v]));
}

function goldenCtx(): Ctx {
  const teams: CareerTeam[] = golden.teams.map((short) => ({
    short,
    name: `${short} Club`,
    color: '#123456',
    color2: '#654321',
    off: (golden.teamRatings as Record<string, { off: number; def: number }>)[short]!.off,
    def: (golden.teamRatings as Record<string, { off: number; def: number }>)[short]!.def,
    conf: short < 'T15' ? 'east' : 'west',
  }));
  const rosters = golden.rosters as Record<string, { guard: { ovr: number }[]; big: { ovr: number }[] }>;
  return {
    teams,
    pools: {
      guards: golden.teams.flatMap((short) =>
        rosters[short]!.guard.map((p, i) => ({ name: `${short} G${i}`, team: short, attrs: attrsFor('guard', p.ovr) })),
      ),
      bigs: golden.teams.flatMap((short) =>
        rosters[short]!.big.map((p, i) => ({ name: `${short} B${i}`, team: short, attrs: attrsFor('big', p.ovr) })),
      ),
    },
    birth: null,
  };
}

function buildFor(pos: 'guard' | 'big', value: number): Career['build'] {
  return Object.fromEntries((pos === 'guard' ? GUARD_KEYS : BIG_KEYS).map((k) => [k, { val: value }]));
}

function draftCareer(seed: string, ovr: number, combine: number[]): Career {
  const career = newCareer({ seed, pos: 'guard', name: 'Test Guard', build: buildFor('guard', 8), games: 'off' });
  const drills = career.draft.combine.map((d, i) => ({ ...d, score: combine[i] ?? 0.5, pct: combine[i] ?? 0.5 }));
  return { ...career, ovr, draft: { ...career.draft, combine: drills } };
}

describe('career golden: combine drills', () => {
  it('matches the values derived from the original norms', () => {
    for (const entry of golden.combine) {
      const value = drillValue(entry.id as 'sprint', entry.v, entry.score, null, entry.pos as 'guard');
      expect(value.text, entry.label).toBe(entry.text);
      expect(value.pct, entry.label).toBeCloseTo(entry.pct, 10);
    }
  });
});

describe('career golden: draft range', () => {
  it('matches the original stock window and shift', () => {
    for (const entry of golden.stock) {
      const career = draftCareer('stock-seed', entry.ovr, entry.combine);
      const interviews = entry.interviewStocks.map((stock, i) => ({
        who: 'GM',
        q: 'q',
        a: [
          { t: 'a', stock, persona: 'grinder' },
          { t: 'b', stock: 0, persona: 'confident' },
          { t: 'c', stock: 0, persona: 'cocky' },
        ],
        team: golden.teams[i] as string,
        answer: 0,
      }));
      const result = stockOf({ ovr: entry.ovr, draft: { combine: career.draft.combine, interviews } });
      expect(result.lo, `ovr ${entry.ovr}`).toBe(entry.lo);
      expect(result.hi, `ovr ${entry.ovr}`).toBe(entry.hi);
      expect(result.shift, `ovr ${entry.ovr}`).toBe(entry.shift);
    }
  });
});

describe('career golden: team pick', () => {
  it('matches the seeded roulette', () => {
    const ctx = goldenCtx();
    for (const entry of golden.picks) {
      const career = draftCareer(entry.seed, 88, [0.2, 0.1, -0.1]);
      const shred: Career = {
        ...career,
        draft: {
          ...career.draft,
          interviews: Object.entries(entry.interest).map(([team, stock]) => ({
            who: 'GM',
            q: 'q',
            a: [
              { t: 'a', stock, persona: 'grinder' },
              { t: 'b', stock: 0, persona: 'confident' },
              { t: 'c', stock: 0, persona: 'cocky' },
            ],
            team,
            answer: 0,
          })),
        },
      };
      const drafted = runDraft(shred, ctx);
      expect(drafted.draft.pick?.o, `pick for ${entry.seed}`).toBe(entry.pick);
      expect(drafted.team, `team for ${entry.seed}`).toBe(entry.team);
    }
  });

  it('matches the seeded draft order', () => {
    const ctx = goldenCtx();
    for (const entry of golden.order) {
      expect(draftOrder(ctx, entry.seed).slice(0, 6), `order for ${entry.seed}`).toEqual(entry.order);
    }
  });
});

describe('career golden: rookie deal', () => {
  it('matches the pick table', () => {
    for (const entry of golden.rookie) {
      const deal = rookieDeal(entry.o);
      expect(deal.years, `pick ${entry.o}`).toBe(entry.years);
      expect(deal.perYear, `pick ${entry.o}`).toBe(entry.perYear);
      expect(deal.option, `pick ${entry.o}`).toBe(entry.option);
    }
  });
});

describe('career golden: injuries', () => {
  it('matches the seeded per-game rolls', () => {
    for (const entry of golden.injuries) {
      const list: Injury[] = [];
      for (let k = 1; k <= 82; k++) {
        const recent = list.some((i) => i.at > k - 5);
        const roll = injuryRoll(entry.seed, entry.year, k, 82, entry.durability, entry.age, false, recent);
        if (roll) list.push(roll);
      }
      expect(list.length, `count for ${entry.seed}/${entry.year}`).toBe(entry.count);
      expect(list.slice(0, 6), `events for ${entry.seed}/${entry.year}`).toEqual(entry.events);
    }
  });
});

describe('career golden: season swings', () => {
  it('matches the seeded up/down and streak rolls', () => {
    for (const entry of golden.swings) {
      const swing = seasonSwing(entry.seed, entry.year, entry.age, entry.contractLeft, 82);
      expect(swing.dir, `dir for ${entry.seed}/${entry.year}`).toBe(entry.dir);
      if (entry.streak) {
        expect(swing.streak.on, `streak for ${entry.seed}/${entry.year}`).toBe(true);
        expect({ from: swing.streak.from, len: swing.streak.len, hot: swing.streak.hot }).toEqual(entry.streak);
      } else {
        expect(swing.streak.on, `streak for ${entry.seed}/${entry.year}`).toBe(false);
      }
    }
  });
});

describe('career golden: playoff odds', () => {
  it('matches the series maths', () => {
    for (const entry of golden.odds) {
      if ('series' in entry) {
        expect(bucketRoundOdds(entry.base as number, entry.series as boolean), `base ${entry.base}`).toBe(entry.p);
        expect(closeChance(entry.p as number)).toBeCloseTo(entry.close as number, 10);
      } else {
        const base =
          0.5 + (entry.myStr - entry.oppStr) * 0.08 + (entry.home ? 0.06 : entry.home === false ? -0.03 : 0) + ((entry.ovr - 76) / 100) * 0.35 + Math.max(0, entry.ovr - 95) * 0.018;
        expect(bucketRoundOdds(base, true)).toBe(entry.p);
      }
    }
  });

  it('matches series state and the rest of the series', () => {
    for (const entry of golden.series) {
      for (const state of entry.states) {
        const mine = seriesState(entry.seed, entry.year, state.idx, entry.p);
        expect(mine.a, `${entry.seed}/${state.idx}`).toBe(state.a);
        expect(mine.b, `${entry.seed}/${state.idx}`).toBe(state.b);
        expect(mine.g).toBeCloseTo(state.g, 12);
      }
      for (const play of entry.plays) {
        const result = seriesPlay(entry.seed, entry.year, 1, entry.p, play.hit);
        expect(result, `${entry.seed} hit=${play.hit}`).toEqual({ won: play.won, my: play.my, opp: play.opp });
      }
    }
  });

  it('keeps the bracket on the series line', () => {
    expect(bestOf7(0.5)).toBeCloseTo(0.5, 12);
    expect(gameOf(bestOf7(0.62))).toBeCloseTo(0.62, 6);
    expect(bucketRoundOdds(0.5, true)).toBe(0.5);
  });
});

describe('career engine: life cycle', () => {
  const ctx = goldenCtx();

  function playSeason(career: Career): Career {
    let active = startSeason(career, ctx);
    let guard = 0;
    while (active.phase === 'season' && active.active && guard++ < 300) {
      if (active.active.injury) {
        active = resolveInjury(active, false);
        continue;
      }
      const before = active.active.k;
      active = advance(active, ctx);
      if (active.phase !== 'season') break;
      if (active.active?.po) {
        let roundGuard = 0;
        while (active.phase === 'season' && active.active?.po && active.active.po.stage !== 'done' && roundGuard++ < 10) {
          active = playRound(active, ctx, null);
        }
        break;
      }
      if (active.active && active.active.k === before) break;
    }
    return active;
  }

  it('drafts, plays two seasons and can retire with a legacy', () => {
    let career = draftCareer('life-1', 88, [0.2, 0.1, 0]);
    const draftedAge = career.age;
    expect(draftedAge === 19 || draftedAge === 20).toBe(true);
    career = runDraft(career, ctx);
    expect(career.team).toBeTruthy();
    expect(career.contract?.years).toBeGreaterThan(0);

    career = playSeason(career);
    expect(career.seasons.length).toBe(1);
    const first = career.seasons[0]!;
    expect(first.wins + first.losses).toBe(82);
    expect(first.stats.gp).toBeGreaterThan(0);

    career = { ...career, contract: { ...career.contract!, left: 1 } };
    career = nextSeason(career, ctx);
    expect(career.phase).toBe('preseason');
    expect(career.age).toBe(draftedAge + 1);

    career = playSeason(career);
    expect(career.seasons.length).toBe(2);

    const retired = retire({ ...career, age: 36, contract: { ...career.contract!, left: 0 }, offers: [] });
    expect(retired.phase).toBe('retired');
    const totals = careerTotals(retired);
    expect(totals.seasons).toBe(2);
    expect(legacyOf(retired).score).toBeGreaterThan(0);
    expect(hofProgress(retired)).toBeGreaterThanOrEqual(0);
    expect(['age', 'seasons', 'nocalls']).toContain(retireReason({ ...retired, phase: 'offseason' }));
  });

  it('keeps a roster and a depth chart that a season can be played from', () => {
    const career = runDraft(draftCareer('life-2', 74, [0, 0, 0]), ctx);
    const roster = career.roster as Roster;
    expect(roster.guard.length).toBe(5);
    const fit = teamFit(ctx, career.team as string, career.pos, roster, null, career.name);
    expect(fit.need).toBeGreaterThanOrEqual(0);
    expect(fit.off).toBeGreaterThanOrEqual(1);
    const bracket = buildBracket(career, ctx, { wins: 48, losses: 34, seed: 5, standings: [], conference: fit.conf });
    expect(bracket.rounds.length).toBe(4);
    expect(bracket.rounds[0]!.p).toBeGreaterThan(0);
  });

  it('grades generated rookies and keeps hash ages stable', () => {
    expect(hashN('Test Guard')).toBe(hashN('Test Guard'));
    const ctx2 = goldenCtx();
    const roster = makeRoster(ctx2, golden.teams[0] as string, 3, []);
    const players: RosterPlayer[] = [...roster.guard, ...roster.big];
    expect(players.length).toBe(9);
    for (const p of players) expect(Number.isFinite(p.ovr)).toBe(true);
  });
});
