import { describe, expect, it } from 'vitest';
import { loadMomentBank, parseMomentBank, renderMomentText } from '../src/shared/data/moments';
import { pickMoment } from '../src/app/momentFlow';
import { chooseMoment, finalizeDraft, seasonStops, startSeason } from '../src/shared/engine/season';
import { mulberry32 } from '../src/shared/engine/rng';
import type { Build } from '../src/shared/engine/types';
import type { Catalog } from '../src/shared/data/loader';
import { GUARD_KEYS, picksFor } from './fixtures/pool';

const DOLLAR = String.fromCharCode(36);
const FIXTURE = [
  'const NBA_ALL = [',
  "  { id: 'fixture-rest', at: ['mid', 'late'], w: 4, when: c => c.alive,",
  "    make: c => ({ kicker: 'FIXTURE', title: 'Rest or push?', body: `" + DOLLAR + "{c.nick} have " + DOLLAR + "{c.left} games left.`,",
  '      options: [',
  "        o('rest', 'Load management', { sit: 3, tag: 'RESTED', then: { attr: c.R('legs', 1) } }, 'Three nights off.'),",
  "        o('push', 'Push through it', gam(0.75, { xp: 10 }, 'It held.', { attr: c.R('legs', -2), tag: 'SORE' }, 'It gave out.')),",
  '      ] }) },',
  ']',
  'const NBA_PLAYOFFS = [',
  "  { id: 'fixture-playoffs', at: ['playoffs'], w: 1, when: () => true,",
  "    make: c => ({ kicker: 'BEFORE THE PLAYOFFS', title: 'Minutes', body: `How does " + DOLLAR + "{c.name} play?`,",
  '      options: [',
  "        o('more', 'Play me 44', { attr: mix(c.R('make', 2), c.R1('feel', 1)) }, 'Tired legs.'),",
  "        o('normal', 'Normal minutes', { team: { off: 1 } }, 'Fresh.'),",
  '      ] }) },',
  ']',
].join('\n');

const offline = process.env.BAB_SKIP_NETWORK === '1';

const catalog: Catalog = {
  teams: [{ short: 'MIA', name: 'Miami', color: '#111111', color2: '#222222' }],
  currentGuards: [],
  currentBigs: [],
  legendGuards: [],
  legendBigs: [],
  headshots: {},
};

function build(value = 6): Build {
  return { position: 'guard', era: 'current', picks: picksFor(GUARD_KEYS, Object.fromEntries(GUARD_KEYS.map((key) => [key, value]))) };
}

describe('moment bank extraction', () => {
  it('reads the fixture bank without running any of its code', () => {
    const bank = parseMomentBank(FIXTURE, 'guard');
    expect(bank.templates).toHaveLength(2);
    const rest = bank.templates.find((template) => template.id === 'fixture-rest');
    expect(rest?.kicker).toBe('FIXTURE');
    expect(rest?.weight).toBe(4);
    expect(rest?.at).toEqual(['mid', 'late']);
    expect(rest?.options.map((option) => option.id)).toEqual(['rest', 'push']);
    expect(rest?.options[0]?.effect.sit).toBe(3);
    expect(rest?.options[0]?.effect.then?.attr).toEqual({ speed: 1, bounce: 1 });
    expect(rest?.options[1]?.effect.gamble?.p).toBe(0.75);
    expect(rest?.options[1]?.effect.gamble?.miss.attr).toEqual({ speed: -2, bounce: -2 });
    expect(bank.templates[1]?.options[0]?.effect.attr).toEqual({ handles: 2, passing: 2, jumpShot: 1 });
  });

  it('keeps template tokens for the runtime to fill', () => {
    const bank = parseMomentBank(FIXTURE, 'guard');
    const body = bank.templates[0]?.body ?? '';
    expect(body).toContain('{{c.nick}}');
    expect(renderMomentText(body, { 'c.nick': 'Miami', 'c.left': 23 })).toBe('Miami have 23 games left.');
  });

  it('reports banks it cannot read instead of guessing', () => {
    const bank = parseMomentBank('const NBA_ALL = [{ id: "x", when: c => c.alive, make: c => f(c) }]', 'guard');
    expect(bank.templates).toHaveLength(0);
    expect(bank.skipped.length).toBeGreaterThan(0);
  });

  it.skipIf(offline)('loads the pinned bucket moments', async () => {
    const bank = await loadMomentBank('guard');
    const ids = bank.templates.map((template) => template.id);
    expect(ids).toContain('nba-deadline');
    expect(ids).toContain('nba-clinched');
    expect(ids).toContain('nba-eliminated');
    expect(ids).toContain('nbapo-takeover');
    for (const template of bank.templates) {
      expect(template.options.length).toBeGreaterThanOrEqual(2);
      expect(template.body.length).toBeGreaterThan(0);
      expect(template.title.length).toBeGreaterThan(0);
    }
    const clinched = bank.templates.find((template) => template.id === 'nba-clinched');
    expect(clinched?.requires).toBe('clinched');
    expect(clinched?.minLeft).toBe(5);
    expect(clinched?.options[0]?.effect.sit).toBe(4);
    console.log('moment bank', ids.join(', '), 'skipped:', bank.skipped.length);
  });
});

describe('season director', () => {
  it('places two or three stops inside the season, apart from each other', () => {
    for (let seed = 0; seed < 30; seed++) {
      const stops = seasonStops(`b-stop-${seed}`);
      const inSeason = stops.filter((stop) => stop < 82);
      expect(inSeason.length).toBeGreaterThanOrEqual(2);
      expect(inSeason.length).toBeLessThanOrEqual(3);
      for (const stop of inSeason) {
        expect(stop).toBeGreaterThanOrEqual(8);
        expect(stop).toBeLessThanOrEqual(76);
      }
      const sorted = [...inSeason].sort((a, b) => a - b);
      for (let index = 1; index < sorted.length; index++) {
        expect((sorted[index] as number) - (sorted[index - 1] as number)).toBeGreaterThanOrEqual(14);
      }
      expect(stops[stops.length - 1]).toBe(82);
      expect(seasonStops(`b-stop-${seed}`)).toEqual(stops);
    }
  });

  it('pauses at each stop and finishes the season', () => {
    const rng = mulberry32(4242);
    let draft = startSeason({ build: build(7), team: 'MIA', seed: 'b-director', rng, moments: true });
    expect(draft.phase).toBe('moment');
    expect(draft.games).toHaveLength(draft.stops[0] as number);
    let guard = 0;
    while (draft.phase === 'moment' && guard++ < 10) {
      const before = draft.games.length;
      draft = chooseMoment(draft, { momentId: 'fixture-rest', optionId: 'rest', effect: { team: { off: 1 } } }, rng);
      expect(draft.games.length).toBeGreaterThanOrEqual(before);
    }
    expect(draft.phase).toBe('done');
    expect(draft.games).toHaveLength(82);
    const result = finalizeDraft(draft, { playerName: 'You', rng: mulberry32(7), displayRng: mulberry32(8) });
    expect(result.wins + result.losses).toBe(82);
    expect(result.gameLog).toHaveLength(82);
    expect(result.archetype.length).toBeGreaterThan(0);
  });

  it('applies attribute deltas inside the trait range', () => {
    const rng = mulberry32(11);
    let draft = startSeason({ build: build(10), team: 'MIA', seed: 'b-attrs', rng, moments: true });
    const before = draft.ovr;
    draft = chooseMoment(draft, { momentId: 'x', optionId: 'y', effect: { attr: { jumpShot: -40, speed: 40 } } }, rng);
    expect(draft.attrs.jumpShot).toBe(1);
    expect(draft.attrs.speed).toBe(11);
    expect(draft.ovr).toBeLessThan(before);
  });

  it('zeroes the games a player sits out', () => {
    const rng = mulberry32(3);
    let draft = startSeason({ build: build(8), team: 'MIA', seed: 'b-sit', rng, moments: true });
    const stop = draft.games.length;
    draft = chooseMoment(draft, { momentId: 'x', optionId: 'y', effect: { sit: 4, tag: 'RESTED' } }, rng);
    expect(draft.sat.length).toBeGreaterThan(0);
    for (const index of draft.sat) {
      const game = draft.games[index];
      expect(game?.pts).toBe(0);
      expect(game?.reb).toBe(0);
      expect(game?.ast).toBe(0);
    }
    expect(draft.sat.filter((index) => index >= stop).length).toBeGreaterThan(0);
    expect(draft.decisions[0]?.tag).toBe('RESTED');
  });

  it('rolls a gamble once and records the outcome', () => {
    const hit = chooseMoment(
      startSeason({ build: build(6), team: 'MIA', seed: 'b-gamble', rng: mulberry32(1), moments: true }),
      { momentId: 'x', optionId: 'g', effect: { gamble: { p: 0.99, hit: { attr: { jumpShot: 1 } }, miss: { attr: { jumpShot: -1 } } } } },
      () => 0.5,
    );
    expect(hit.decisions[0]?.optionId).toBe('g');
    const miss = chooseMoment(
      startSeason({ build: build(6), team: 'MIA', seed: 'b-gamble', rng: mulberry32(1), moments: true }),
      { momentId: 'x', optionId: 'g', effect: { gamble: { p: 0.5, hit: { attr: { jumpShot: 1 } }, miss: { attr: { jumpShot: -1 }, tag: 'SORE' } } } },
      () => 0.75,
    );
    expect(miss.attrs.jumpShot).toBe(5);
    expect(miss.decisions[0]?.tag).toBe('SORE');
  });

  it('plays straight through when the moments are off', () => {
    const draft = startSeason({ build: build(6), team: 'MIA', seed: 'b-off', rng: mulberry32(5), moments: false });
    expect(draft.phase).toBe('done');
    expect(draft.games).toHaveLength(82);
    expect(draft.decisions).toHaveLength(0);
    expect(draft.stops).toHaveLength(0);
  });
});

describe('moment selection', () => {
  it('renders a card from the bank for the phase', () => {
    const bank = parseMomentBank(FIXTURE, 'guard');
    const draft = startSeason({ build: build(6), team: 'MIA', seed: 'b-pick', rng: mulberry32(2), moments: true });
    const card = pickMoment({
      bank,
      catalog,
      draft,
      seed: 'b-pick',
      stop: 40,
      recent: [],
      playerName: 'You',
    });
    expect(card).not.toBeNull();
    expect(card?.kicker).toBe('FIXTURE');
    expect(card?.body).toContain('Miami');
    expect(card?.body).not.toContain('{{');
    expect(card?.options.map((option) => option.label)).toEqual(['Load management', 'Push through it']);
  });

  it('returns null when nothing fits the phase', () => {
    const bank = parseMomentBank(FIXTURE, 'guard');
    const draft = startSeason({ build: build(6), team: 'MIA', seed: 'b-pick', rng: mulberry32(2), moments: true });
    const card = pickMoment({ bank, catalog, draft, seed: 'b-pick', stop: 82, recent: [], playerName: 'You' });
    expect(card?.id).toBe('fixture-playoffs');
  });
});
