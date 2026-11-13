import { clamp, seededRng, type Rng } from '../rng';
import { ovrFromValues } from '../ovr';
import type { Position } from '../types';
import * as K from './rules';
import * as C from './core';

export const MINI_GAMES: Record<Position, string[]> = {
  guard: ['iso', 'pnr', 'clutch-shot', 'free-throws', 'lockdown', 'fast-break', 'half-court'],
  big: ['post-up', 'board', 'rim-protect', 'alley-oop', 'half-court', 'pnr', 'free-throws'],
};

export const STOP_GAMES = [9, 25, 41, 57, 73];

export function randomCareerSeed(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join('');
}

export function newCareer(opts: { seed?: string; pos: Position; name: string; build: C.Traits; games: K.GamesMode }): C.Career {
  const seed = opts.seed ?? randomCareerSeed();
  const r = seededRng(`career-${seed}`);
  const types = Object.keys(opts.build);
  const values = Object.fromEntries(types.map((t) => [t, opts.build[t]?.val ?? 5]));
  const ovr = ovrFromValues(values, opts.pos);
  const luck = seededRng(`dur-${seed}`)() * 2 - 1;
  const sizeV = opts.build.size?.val ?? 5;
  const dur = clamp(2 + 0.5 * clamp(sizeV, 0, 11) + luck, 1, 10) / 1.1;
  const durability = C.r10(clamp(dur, 1, 10));
  return {
    v: K.CAREER_V,
    seed,
    pos: opts.pos,
    name: opts.name,
    games: opts.games,
    build: opts.build,
    base: opts.build,
    ovr,
    age: 19 + Math.floor(r() * 2),
    year: 0,
    season: K.FIRST_SEASON,
    phase: 'draft',
    step: 'combine',
    draft: { combine: C.combineDrills(opts.pos), interviews: [], picks: [], pick: null, persona: null },
    team: null,
    fit: null,
    roster: null,
    league: null,
    contract: null,
    role: 'Starter',
    lastRole: null,
    dev: { points: 0, spent: 0 },
    durability,
    durBase: durability,
    rep: 5,
    injuries: [],
    seasons: [],
    events: [],
    decisions: [],
    nextMods: null,
    goals: [],
    active: null,
    offers: null,
    talks: null,
    hof: null,
    retired: false,
    earnings: 0,
    shoe: null,
    legacyBonus: 0,
    legacyCamp: 0,
    bodyWork: 0,
    kept: {},
    dealt: {},
    gone: [],
    off: null,
    aging: null,
    updatedAt: Date.now(),
  };
}

export function withCareer(c: C.Career): C.Career {
  return { ...c, updatedAt: Date.now() };
}

function needsRoster(c: C.Career, ctx: C.Ctx, short: string): C.Roster {
  if (c.roster?.team === short) return c.roster;
  const kept = c.kept[short];
  if (kept) {
    const years = rosterYrs(c) - kept.yrs;
    if (years <= 0) return kept.roster;
    const r = seededRng(`${c.seed}-back-${short}-${kept.yrs}`);
    const ro: C.Roster = { team: short, guard: [...kept.roster.guard], big: [...kept.roster.big] };
    for (const pos of ['guard', 'big'] as Position[]) {
      let list = [...kept.roster[pos]];
      for (let y = 0; y < years; y++) list = ageGroup(pos, list, r);
      ro[pos] = list;
    }
    return ro;
  }
  return C.makeRoster(ctx, short, rosterYrs(c), outOf(c, short));
}

function ageStep(age: number, x: number) {
  return age <= 24 ? 1 + Math.floor(x * 4) : age <= 27 ? Math.floor(x * 3) : age <= 30 ? Math.floor(x * 3) - 1 : age <= 32 ? Math.floor(x * 3) - 2 : -1 - Math.floor(x * 4);
}

function ageGroup(pos: Position, list: C.RosterPlayer[], r: Rng): C.RosterPlayer[] {
  const grown = list.map((p) => ({ ...p, age: p.age + 1, ovr: clamp(p.rookie && p.ovr >= 82 ? Math.max(p.ovr, Math.min(90, p.ovr + Math.ceil(ageStep(p.age + 1, r()) / 3))) : p.ovr + ageStep(p.age + 1, r()), 55, 99) }));
  const kept = grown.filter((p) => p.age < C.RETIRE_AT[pos]! && !(p.age >= C.RETIRE_AT[pos]! - 2 && r() < 0.35));
  const taken = new Set(kept.map((p) => p.name));
  const out = [...kept];
  while (out.length < C.KEEP[pos]) {
    out.push({ name: `Rookie ${pos === 'guard' ? 'G' : 'F'}${out.length + 1}`, pos, ovr: clamp(Math.round(73 + (r() + r() + r() - 1.5) * 12), 58, 88), age: 21 + Math.floor(r() * 2), rookie: true, from: null });
    taken.add(out[out.length - 1]!.name);
  }
  return out.sort(C.byOvr).slice(0, C.KEEP[pos]);
}

export const rosterYrs = (c: C.Career) => Math.max(0, (c.season ?? K.FIRST_SEASON) + (c.phase === 'offseason' ? 1 : 0) - K.FIRST_SEASON);
export const outOf = (c: C.Career, short: string | null = null) => [
  ...(c.gone ?? []),
  ...Object.entries(c.dealt ?? {})
    .filter(([, t]) => t !== short)
    .map(([n]) => n),
];

export function seasonStats(games: C.GameLine[]): C.SeasonRecord['stats'] {
  const played = games.filter((g) => !g.sat);
  const gp = played.length || 1;
  const sum = (k: 'pts' | 'reb' | 'ast') => played.reduce((s, g) => s + g[k], 0);
  const pts = sum('pts');
  const reb = sum('reb');
  const ast = sum('ast');
  return { ppg: C.r10(pts / gp), rpg: C.r10(reb / gp), apg: C.r10(ast / gp), spg: 0, bpg: 0, gp: played.length, pts, reb, ast };
}

export function goalsFor(c: C.Career, dc: { starter: boolean }): C.Goal[] {
  const raw = K.GOALS[c.pos](c.ovr);
  const full = raw.map(([k, verb, n, unit]) => ({ k, label: `${verb} ${n.toLocaleString()} ${unit}`, n }));
  if (dc.starter) return full;
  return raw.map(([k, verb, n, unit]) => (k === 'wins' ? (full.find((g) => g.k === k) as C.Goal) : { k, label: `${verb} ${C.r10(n * 0.6)} ${unit} off the bench`, n: C.r10(n * 0.6) }));
}

const goalMet = (g: C.Goal, s: { stats: C.SeasonRecord['stats']; wins: number }) =>
  (g.k === 'wins' ? s.wins : (s.stats[g.k as 'ppg'] ?? 0)) >= g.n;

function feedGames(lines: C.GameLine[]): string[] {
  return lines.map((g) => `${g.won ? 'W' : 'L'} ${g.mySc}-${g.oppSc} vs ${g.opponent}${g.sat ? ' (DNP)' : ''}`);
}

export function startSeason(c: C.Career, ctx: C.Ctx): C.Career {
  const roster = c.roster ?? needsRoster(c, ctx, c.team as string);
  const cc = { ...c, roster };
  const fit = C.teamFit(ctx, c.team as string, c.pos, roster, c.league, c.name);
  const dc = C.depthChart({ ...cc, contractStarter: !!c.contract?.starter, lastRole: c.lastRole }, roster);
  const team = C.simTeam(fit, c.nextMods, { ...cc, bench: !dc.starter });
  const seed = `${c.seed}-y${c.year + 1}`;
  const season = C.teamSeason(seed, team, c.ovr, ctx, c.team as string);
  const swing = C.seasonSwing(c.seed, c.year, c.age, c.contract?.left ?? null, K.REGULAR_GAMES);
  const mods: Record<string, number>[] = Array.from({ length: K.REGULAR_GAMES }, () => ({}));
  if (swing.dir !== 0) for (let i = 0; i < K.REGULAR_GAMES; i++) mods[i]!.form = swing.dir;
  if (swing.streak.on) {
    for (let i = swing.streak.from; i < Math.min(K.REGULAR_GAMES, swing.streak.from + swing.streak.len); i++) mods[i]!.lean = swing.streak.hot ? 1 : -1;
    for (let i = 0; i < K.REGULAR_GAMES; i++) mods[i]!.streak = swing.streak.hot ? 1 : -1;
  }
  const benched = dc.starter
    ? null
    : { weeks: K.REGULAR_GAMES, behind: dc.ahead[dc.ahead.length - 1]?.name ?? 'the starter', label: dc.label };
  const feed: C.FeedItem[] = [];
  if (benched) {
    feed.push({ kind: 'note', k: 0, text: `${benched.behind} starts. ${c.name} comes off the bench this season: fewer minutes, a smaller role.` });
  }
  return withCareer({
    ...cc,
    phase: 'season',
    fit,
    role: dc.starter ? 'Starter' : 'Backup',
    goals: goalsFor(cc, dc),
    active: {
      k: 0,
      base: season.games,
      mods,
      sat: [],
      lines: [],
      feed,
      injury: null,
      moment: null,
      benched,
      goals: goalsFor(cc, dc),
      seed,
      po: null,
      final: null,
      streak: swing.streak.on ? { from: swing.streak.from, to: swing.streak.from + swing.streak.len, lean: swing.streak.hot ? 1 : -1, label: swing.streak.hot ? 'HOT STREAK' : 'COLD STRETCH' } : null,
    },
  });
}

function statLine(c: C.Career, k: number, ctx: C.Ctx): { pts: number; reb: number; ast: number } {
  const values = Object.fromEntries(Object.entries(c.build).map(([t, ch]) => [t, ch.val]));
  const rolled = rollStatAverages(values, c.pos);
  const a = c.active as C.ActiveSeason;
  const mods = a.mods[k - 1] ?? {};
  const usage = clamp((0.42 + (c.ovr - 70) * 0.012) * (a.benched ? 0.62 : 1), 0.3, 0.75);
  const shape = 1 + (mods.form ?? 0) * 0.06 + (mods.lean ?? 0) * 0.04 + (mods.hotHand ?? 0) * 0.08;
  const r = seededRng(`${a.seed}-line-${k}`);
  const spread = (mean: number) => Math.max(0, Math.round(mean * (0.35 + 1.3 * r()) * (usage / 0.55) * shape));
  void ctx;
  return { pts: spread(rolled.ppg), reb: spread(rolled.rpg), ast: spread(rolled.apg) };
}

function rollStatAverages(values: Record<string, number>, pos: Position): { ppg: number; rpg: number; apg: number } {
  const norm = (k: string) => clamp((values[k] ?? 5) / 11, 0, 1);
  if (pos === 'guard') {
    const ppg = 6 + 22 * (0.5 * norm('jumpShot') + 0.25 * norm('finishing') + 0.25 * norm('clutch'));
    const apg = 1.5 + 8.5 * (0.6 * norm('passing') + 0.4 * norm('basketballIQ'));
    const rpg = 1.5 + 5 * (0.5 * norm('size') + 0.5 * norm('bounce'));
    return { ppg, rpg, apg };
  }
  const ppg = 6 + 21 * (0.55 * norm('finishing') + 0.25 * norm('size') + 0.2 * norm('jumpShot'));
  const rpg = 3 + 11 * (0.6 * norm('rebounding') + 0.4 * norm('size'));
  const apg = 0.8 + 4.5 * (0.6 * norm('playmaking') + 0.4 * norm('basketballIQ'));
  return { ppg, rpg, apg };
}

function recentInjury(c: C.Career, at: number): boolean {
  return c.injuries.some((i) => i.year === c.year + 1 && i.at > at - 5);
}

export function advance(c: C.Career, ctx: C.Ctx): C.Career {
  const a = c.active;
  if (c.phase !== 'season' || !a || a.moment || a.injury) return c;
  if (a.k >= K.REGULAR_GAMES) return finishRegular(c, ctx);
  let k = a.k;
  const feed = [...a.feed];
  const lines = [...a.lines];
  const sat = [...a.sat];
  const mods = a.mods.map((m) => ({ ...m }));
  let injury: C.Injury | null = null;
  let stop: C.ActiveSeason['moment'] = null;
  const horizon = Math.min(K.REGULAR_GAMES, a.k + K.STEP);
  const chunk: C.GameLine[] = [];
  let headline: string | null = null;
  let guard = 0;
  while (k < horizon && !injury && !stop && guard++ < K.STEP + 1) {
    const next = k + 1;
    const isSat = sat.includes(next);
    const base = a.base[next - 1] as C.GameLine;
    const line = statLine(c, next, ctx);
    const game: C.GameLine = { ...base, ...line, sat: isSat };
    lines.push(game);
    chunk.push(game);
    k = next;
    if (!isSat) {
      const roll = C.injuryRoll(c.seed, c.year, next, K.REGULAR_GAMES, c.durability, c.age, isSat, recentInjury(c, next));
      if (roll) {
        injury = roll;
        break;
      }
    }
    if (STOP_GAMES.includes(next) && k < K.REGULAR_GAMES) {
      const list = MINI_GAMES[c.pos];
      const pick = list[Math.floor(seededRng(`${c.seed}-${c.year}-${next}-moment`)() * list.length)] as string;
      const traitValue = C.averageTrait(c.build, traitsFor(pick));
      if (c.games === 'simple') stop = { stop: next, game: pick, title: pick.toUpperCase(), trait: traitValue };
      else {
        const hit = seededRng(`${c.seed}-${c.year}-${next}-hit`)() < C.momentHitRate(traitValue);
        feed.push({ kind: 'moment', k: next, title: pick.toUpperCase(), detail: `${hit ? 'Made the play' : 'Missed the play'} (simulated)`, hit });
        const lean = hit ? 0.4 : -0.4;
        for (let i = next - 1; i < Math.min(K.REGULAR_GAMES, next + 3); i++) mods[i] = { ...mods[i], lean: (mods[i]?.lean ?? 0) + lean };
      }
    }
  }
  if (chunk.length) {
    headline = `${chunk.filter((g) => g.won).length}-${chunk.filter((g) => !g.won).length} over the last ${chunk.length}`;
    feed.push({ kind: 'games', k, lines: feedGames(chunk), headline });
  }
  const nextCareer: C.Career = { ...c, active: { ...a, k, lines, sat, mods, feed, injury: injury ?? null, moment: stop }, updatedAt: Date.now() };
  return nextCareer;
}

function traitsFor(game: string): string[] {
  const map: Record<string, string[]> = {
    iso: ['handles', 'speed'],
    pnr: ['basketballIQ', 'passing'],
    'clutch-shot': ['jumpShot', 'clutch'],
    'free-throws': ['jumpShot', 'clutch'],
    lockdown: ['perimeterDefense', 'speed'],
    'fast-break': ['passing', 'basketballIQ'],
    'half-court': ['handles', 'jumpShot', 'finishing'],
    'post-up': ['finishing', 'size'],
    board: ['rebounding', 'bounce'],
    'rim-protect': ['interiorDefense', 'bounce'],
    'alley-oop': ['bounce', 'finishing'],
  };
  return map[game] ?? ['basketballIQ'];
}

export function playMoment(c: C.Career, hit: boolean): C.Career {
  const a = c.active;
  if (!a?.moment) return c;
  const feed = [...a.feed, { kind: 'moment' as const, k: a.moment.stop, title: a.moment.title, detail: hit ? 'Made the play' : 'Missed the play', hit }];
  return withCareer({ ...c, active: { ...a, moment: null, feed } });
}

export function resolveInjury(c: C.Career, play: boolean): C.Career {
  const a = c.active;
  const inj = a?.injury;
  if (!a || !inj) return c;
  const r = seededRng(`${c.seed}-injres-${c.year}-${inj.at}`);
  let wear = inj.serious ? 0.6 : 0.2;
  let lasting = inj.serious ? 0.4 : inj.games >= K.BIG_INJURY ? 0.15 : 0;
  let text: string;
  let sat = [...a.sat];
  const mods = a.mods.map((m) => ({ ...m }));
  if (play && !inj.serious) {
    const worse = r() < 0.35;
    wear += worse ? 0.5 : 0.3;
    lasting += worse ? 0.15 : 0.05;
    if (worse) text = `Played through the ${inj.kind}, then it got worse. Out ${inj.games} games.`;
    else text = `Playing through the ${inj.kind}. Not himself for ${inj.games + 2} games.`;
    const from = inj.at;
    const to = Math.min(K.REGULAR_GAMES, inj.at + inj.games + 2);
    if (worse) {
      for (let i = from + 1; i <= Math.min(K.REGULAR_GAMES, from + inj.games); i++) sat.push(i);
      for (let i = to - inj.games - 1; i < to; i++) if (i > 0) mods[i - 1] = { ...mods[i - 1], lean: (mods[i - 1]?.lean ?? 0) - 1 };
    } else {
      for (let i = from; i < to; i++) mods[i] = { ...mods[i], lean: (mods[i]?.lean ?? 0) - 1 };
    }
  } else if (inj.serious) {
    text = `${inj.kind}: season over.`;
    for (let i = inj.at + 1; i <= K.REGULAR_GAMES; i++) sat.push(i);
  } else {
    text = `Out ${inj.games} games with the ${inj.kind}.`;
    for (let i = inj.at + 1; i <= Math.min(K.REGULAR_GAMES, inj.at + inj.games); i++) sat.push(i);
  }
  sat = [...new Set(sat)];
  const injuries = [...c.injuries, { year: c.year + 1, at: inj.at, kind: inj.kind, games: inj.games, played: !!play, serious: !!inj.serious }];
  const durability = C.r10(Math.max(1, c.durability - wear));
  const durBase = lasting ? C.r10(Math.max(1, c.durBase - lasting)) : c.durBase;
  return withCareer({
    ...c,
    injuries,
    durability,
    durBase,
    active: { ...a, injury: null, sat, mods, feed: [...a.feed, { kind: 'injury', k: inj.at, text }] },
  });
}

export function finishRegular(c: C.Career, ctx: C.Ctx): C.Career {
  const a = c.active;
  if (!a) return c;
  const wins = a.lines.filter((g) => g.won).length + a.base.filter((g) => g.g > a.k && g.won).length;
  const losses = K.REGULAR_GAMES - wins;
  const fit = c.fit as C.Fit;
  const conference = fit.conf;
  const { rows, seedNumber } = C.conferenceStandings(ctx, c.team as string, conference, wins, `${c.seed}-${c.year}`);
  const final: C.FinalSeason = { wins, losses, seed: seedNumber, standings: rows, conference };
  const made = C.madePlayoffs(wins, seedNumber);
  if (!made) return bookSeason({ ...c, active: { ...a, final, po: null } }, ctx);
  const po = C.buildBracket({ ...c, active: { ...a, final } } as C.Career, ctx, final);
  if (a.injury?.serious) return bookSeason({ ...c, active: { ...a, final, po: C.watchBracket(c, ctx, po) } }, ctx);
  return withCareer({ ...c, active: { ...a, final, po } });
}

export function playRound(c: C.Career, ctx: C.Ctx, hit: boolean | null): C.Career {
  void ctx;
  const a = c.active;
  const po = a?.po;
  if (!a || !po || po.stage === 'done') return c;
  const rd = po.rounds[po.idx] as C.Round;
  const r = seededRng(`${c.seed}-por-${c.year}-${po.idx}`);
  const auto = hit === null;
  const won = r() < (auto ? rd.p : hit ? 1 : clamp((rd.p - 0.4) / 0.6, 0.03, 0.97));
  const fav = won ? rd.p : 1 - rd.p;
  const lens = fav >= 0.8 ? [0, 0, 1, 1] : fav >= 0.55 ? [1, 2, 2, 3] : [2, 3, 3];
  const other = lens[Math.floor(r() * lens.length)] as number;
  let mySc: number;
  let oppSc: number;
  if (rd.series) {
    const series = auto ? null : C.seriesPlay(c.seed, c.year, po.idx, rd.p, !!hit);
    mySc = series ? series.my : won ? 4 : other;
    oppSc = series ? series.opp : won ? other : 4;
  } else {
    const gap = auto ? 15 + Math.floor(r() * 16) : 1 + Math.floor(r() * 8);
    if (won) {
      mySc = Math.round(100 + (hit ? 0.8 : 0.25) * 12 + r() * 10);
      oppSc = Math.max(80, mySc - gap);
    } else {
      oppSc = Math.round(104 + r() * 16);
      mySc = Math.max(80, oppSc - gap);
    }
  }
  const entry: C.Round = { ...rd, played: true, won, mySc, oppSc, hit: auto ? null : hit, game: null };
  const rounds = po.rounds.map((x, i) => (i === po.idx ? entry : x));
  const fin = rd.name === K.FINAL_ROUND;
  const done = !won || fin;
  const nextPo: C.PlayoffState = { ...po, rounds, line: [...po.line, entry], idx: done ? po.idx : po.idx + 1, stage: done ? 'done' : 'round', won: won && fin, out: !won };
  const next: C.Career = { ...c, active: { ...a, po: nextPo } };
  return done ? bookSeason(next, ctx) : withCareer(next);
}

function playInMade(po: C.PlayoffState | null): boolean {
  const first = po?.rounds[0];
  if (!first || first.name !== K.PLAY_IN) return true;
  return !!first.won;
}

export function bookSeason(c: C.Career, ctx: C.Ctx): C.Career {
  const a = c.active;
  if (!a?.final) return c;
  const f = a.final;
  const po = a.po;
  const started = a.lines.filter((g) => !g.sat);
  const share = started.length / Math.max(1, K.REGULAR_GAMES);
  const can = (k: keyof typeof K.MIN_GAMES) => share >= (K.MIN_GAMES[k] as number) - 1e-9;
  const stats = seasonStats(a.lines);
  const averaged = { ...stats, spg: 0, bpg: 0 };
  const award = can('award') && (() => {
    const r = seededRng(`${c.seed}-mvp-${c.year}`);
    const score = stats.ppg + stats.apg * 1.5 + stats.rpg * 0.75 + (f.wins - 55) * 0.25;
    const u = clamp(r(), 0.001, 0.999);
    const rival = 54 + 6 * Math.log(u / (1 - u));
    return f.wins >= 48 && stats.ppg >= 20 && score > rival;
  })();
  const allPro = can('first') && K.allProFor(c.pos, stats);
  const proBowl = (can('honor') && K.proBowlFor(c.pos, stats)) || award || allPro;
  const rounds: C.SeasonRoundRecord[] = (po?.line ?? []).map((x) => ({ round: x.name, opponent: x.oppName, won: !!x.won, mySc: x.mySc ?? 0, oppSc: x.oppSc ?? 0, series: !!x.series }));
  const goals = c.goals.map((g) => ({ ...g, met: goalMet(g, { stats, wins: f.wins }) }));
  const perf = K.seasonScore(c.pos, { ...stats, wins: f.wins, award, champion: !!po?.won });
  const season: C.SeasonRecord = {
    year: c.year + 1,
    season: c.season,
    age: c.age,
    team: c.team as string,
    teamName: (c.fit as C.Fit).name,
    ovr: c.ovr,
    role: c.role,
    wins: f.wins,
    losses: f.losses,
    playoffs: !!po?.line?.length && playInMade(po),
    champion: !!po?.won,
    rounds,
    stats: averaged,
    award,
    awardName: 'MVP',
    proBowl,
    allPro: allPro || (award && K.allProNear(c.pos, stats)),
    roy: c.seasons.length === 0 && can('honor') && perf >= 0.55,
    fmvp: false,
    goals,
    missed: a.lines.filter((g) => g.sat).length,
    benched: a.benched ? K.REGULAR_GAMES : 0,
  };
  if (po?.won) {
    const chance = c.role === 'Backup' ? 0.05 : perf >= 0.7 ? 0.8 : perf >= 0.45 ? 0.45 : 0.1;
    season.fmvp = seededRng(`${c.seed}-fmvp-${c.year}`)() < chance;
  }
  const base = c.age <= K.DEV_YOUNG ? 2 : c.age < K.DEV_PRIME ? 1 : 0;
  const dev = { ...c.dev, points: c.dev.points + base + (award || season.roy ? 1 : 0) + (season.allPro ? 1 : 0) };
  const rep = clamp(c.rep + (goals.filter((g) => g.met).length >= 2 ? 1 : 0) + (po?.won ? 1 : 0) - (perf < 0.25 ? 1 : 0), 1, 10);
  const contract = c.contract ? { ...c.contract, left: Math.max(0, c.contract.left - 1) } : null;
  const healed = healDurability({ ...c, age: c.age + 1 });
  let next: C.Career = withCareer({
    ...c,
    phase: 'offseason',
    seasons: [...c.seasons, season],
    contract,
    dev,
    rep,
    lastRole: started.length >= K.REGULAR_GAMES / 2 ? 'Starter' : 'Backup',
    active: null,
    goals: [],
    earnings: C.r10(c.earnings + (c.contract?.perYear ?? 0) + (c.shoe?.perYear ?? 0)),
    nextMods: null,
    talks: null,
    ...healed,
  });
  next = offseason(next, ctx, season);
  return next;
}

function healDurability(c: C.Career): { durability: number; durBase: number } {
  const base = c.durBase ?? c.durability ?? 5;
  const d = c.durability ?? base;
  const fadeAt = Math.max(29, K.AGE_DECLINE);
  return d >= base ? { durBase: base, durability: d } : { durBase: base, durability: C.r10(d + (base - d) * (c.age >= fadeAt ? 0.4 : 0.65)) };
}

function careerDrift(c: C.Career, ctx: C.Ctx, r: Rng): Record<string, { off: number; def: number }> {
  const keep = 0.7;
  const swing = Math.sqrt(1 - keep * keep);
  const gauss = () => (r() + r() + r() + r() - 2) * Math.sqrt(3);
  const offs = ctx.teams.map((t) => t.off);
  const defs = ctx.teams.map((t) => t.def);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const sd = (v: number[]) => {
    const m = mean(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1;
  };
  const shape = { off: { m: mean(offs), sd: sd(offs) }, def: { m: mean(defs), sd: sd(defs) } };
  const league: Record<string, { off: number; def: number }> = {};
  for (const team of ctx.teams) {
    const d = c.league?.[team.short] ?? { off: 0, def: 0 };
    const g0 = gauss();
    const move = (k: 'off' | 'def') => {
      const { m, sd: s } = shape[k];
      const now = team[k] + (Number.isFinite(d[k]) ? d[k] : 0);
      const g = 0.75 * g0 + 0.66 * gauss();
      return C.r10(clamp(m + (now - m) * keep + g * s * swing, 1.5, 9.8) - team[k]);
    };
    league[team.short] = { off: move('off'), def: move('def') };
  }
  return league;
}

function rosterMoves(c: C.Career, ctx: C.Ctx, r: Rng): { roster: C.Roster; moves: string[] } {
  const old = c.roster ?? needsRoster(c, ctx, c.team as string);
  const ro: C.Roster = { team: old.team, guard: [], big: [] };
  const moves: string[] = [];
  const taken = new Set([...old.guard, ...old.big].map((p) => p.name));
  for (const pos of ['guard', 'big'] as Position[]) {
    const kept: C.RosterPlayer[] = [];
    for (const p0 of old[pos]) {
      const p = { ...p0, age: p0.age + 1, ovr: clamp(p0.rookie && p0.ovr >= 82 ? Math.max(p0.ovr, Math.min(90, p0.ovr + Math.ceil(ageStep(p0.age + 1, r()) / 3))) : p0.ovr + ageStep(p0.age + 1, r()), 55, 99) };
      if (p.age >= C.RETIRE_AT[pos]! || (p.age >= C.RETIRE_AT[pos]! - 2 && r() < 0.35)) {
        moves.push(`${p.name} retires after ${Math.max(1, p.age - 22)} seasons.`);
        continue;
      }
      if (p.age > 25 && r() < 0.11) {
        const to = ctx.teams[Math.floor(r() * ctx.teams.length)] as C.CareerTeam;
        if (to.short !== ro.team) {
          moves.push(`${p.name} leaves in free agency for the ${to.name}.`);
          continue;
        }
      }
      kept.push(p);
    }
    while (kept.length < C.KEEP[pos]) {
      if (r() < 0.55) {
        const pool = (pos === 'guard' ? ctx.pools.guards : ctx.pools.bigs).filter((p) => p.team !== ro.team && !taken.has(p.name));
        const pick = pool[Math.floor(r() * pool.length)];
        if (pick) {
          taken.add(pick.name);
          kept.push({ name: pick.name, pos, ovr: ovrFromValues(pick.attrs ?? {}, pos), age: C.hashN(pick.name) % 12 + 22, from: pick.team });
          moves.push(`Signed ${pos === 'guard' ? 'G' : 'F/C'} ${pick.name} from the ${pick.team}.`);
          continue;
        }
      }
      const rd = 1 + Math.floor(r() * K.DRAFT_ROUNDS);
      const pickOvr = clamp(Math.round(79 - rd * 3 + (r() + r() - 1) * 8), 60, 88);
      const name = `Rookie ${pos === 'guard' ? 'G' : 'F'}${kept.length + 1}`;
      kept.push({ name, pos, ovr: pickOvr, age: 22, rookie: true, from: null });
      moves.push(`Drafted ${pos === 'guard' ? 'G' : 'F/C'} ${name} in round ${rd}.`);
    }
    ro[pos] = kept.sort(C.byOvr).slice(0, C.KEEP[pos]);
  }
  return { roster: ro, moves };
}

function offseasonEvents(c: C.Career, moved: boolean, r: Rng): { c: C.Career; text: string } {
  const fit = c.fit as C.Fit;
  const rep = c.rep ?? 5;
  const lastWins = c.seasons[c.seasons.length - 1]?.wins ?? 41;
  const rookieLeftOne = c.contract?.kind === 'rookie' && c.contract.left === 1;
  const fits = K.EVENTS.filter((e) => (!e.when || e.when(rep, c.age, rookieLeftOne, lastWins)) && !(moved && K.STAY_EVENTS.has(e.id)));
  const wOf = (e: (typeof K.EVENTS)[number]) => e.w * (e.good ? (rep >= 7 ? 1.6 : rep <= 3 ? 0.5 : 1) : e.bad ? (rep <= 3 ? 1.8 : rep >= 7 ? 0.6 : 1) : 1);
  const total = fits.reduce((s, e) => s + wOf(e), 0);
  let roll = r() * total;
  let ev = fits[0] as (typeof K.EVENTS)[number];
  for (const e of fits) {
    roll -= wOf(e);
    if (roll <= 0) {
      ev = e;
      break;
    }
  }
  const text = ev.text(fit.name, c.name);
  const nextMods = ev.mods ? { ...(c.nextMods ?? {}), ...ev.mods } : c.nextMods;
  const next: C.Career = {
    ...c,
    nextMods,
    rep: clamp(rep + (ev.rep ?? 0), 1, 10),
    durability: ev.durability != null ? C.r10(clamp((c.durability ?? 5) + ev.durability, 1, 10)) : c.durability,
    durBase: ev.durBase != null ? C.r10(clamp(c.durBase + ev.durBase, 1, 10)) : c.durBase,
    dev: ev.dev ? { ...c.dev, points: c.dev.points + ev.dev } : c.dev,
    events: [...c.events, { year: c.year + 1, text, id: ev.id }],
  };
  return { c: next, text };
}

function maybeShoeDeal(c: C.Career): C.Career {
  const r = seededRng(`${c.seed}-shoe-${c.year}`);
  const recent = c.seasons.slice(-2);
  const last = recent[recent.length - 1];
  const star = recent.some((s) => s.award || s.allPro);
  const tier = c.shoe?.tier;
  let next: 'deal' | 'signature' | null = null;
  const lastScore = last ? K.seasonScore(c.pos, { ...last.stats, wins: last.wins, award: last.award, champion: last.champion }) : 0;
  if (!tier && (c.rep ?? 5) >= 7 && last && (lastScore >= 0.6 || star) && r() < 0.35) next = 'deal';
  else if (tier === 'deal' && (c.rep ?? 5) >= 9 && star && r() < 0.3) next = 'signature';
  if (!next) return c;
  const what = next === 'signature' ? 'his own signature shoe' : 'a national shoe deal';
  const bump = K.SHOE[next].legacy;
  return {
    ...c,
    shoe: { tier: next, year: c.year + 1, perYear: K.SHOE[next].perYear },
    legacyBonus: c.legacyBonus + bump,
    events: [...c.events, { year: c.year + 1, text: `${c.name} signs ${what}. ${next === 'signature' ? 'A face of the league now.' : 'The name travels now.'} +${bump} legacy.` }],
    decisions: [...c.decisions, { year: c.year + 1, text: `Signed ${what} ($${K.SHOE[next].perYear}M a year)` }],
  };
}

export function marketValue(c: C.Career): number {
  const last = c.seasons.slice(-2);
  const perf = last.length ? last.reduce((s, x) => s + K.seasonScore(c.pos, { ...x.stats, wins: x.wins, award: x.award, champion: x.champion }), 0) / last.length : 0.3;
  const ageCut = c.age >= 33 ? 0.6 : c.age >= 30 ? 0.8 : 1;
  const [lo, hi] = K.MONEY[c.pos];
  const repCut = 0.9 + (c.rep ?? 5) * 0.02;
  return C.r10((lo + (hi - lo) * clamp(perf, 0, 1) * ageCut) * repCut);
}

export function contractSituation(c: C.Career, ctx: C.Ctx): C.Offer[] | null {
  if (!c.contract || c.contract.left > 0) return null;
  if (c.age >= retireAge(c) || c.seasons.length >= K.MAX_SEASONS) return null;
  const r = seededRng(`${c.seed}-fa-${c.year}`);
  const value = marketValue(c);
  const last = c.seasons[c.seasons.length - 1] as C.SeasonRecord;
  const perf = K.seasonScore(c.pos, { ...last.stats, wins: last.wins, award: last.award, champion: last.champion });
  if (c.age >= K.AGE_DECLINE + 3 && perf < 0.35) return [];
  const repYrs = (c.rep ?? 5) >= 8 ? 1 : (c.rep ?? 5) <= 3 ? -1 : 0;
  const years = clamp((c.age >= 32 ? 1 + Math.floor(r() * 2) : c.age >= 29 ? 2 + Math.floor(r() * 2) : 3 + Math.floor(r() * 3)) + repYrs, 1, 6);
  const fitAt = (short: string) => C.teamFit(ctx, short, c.pos, needsRoster(c, ctx, short), c.league, c.name);
  const others = ctx.teams
    .filter((t) => t.short !== c.team)
    .sort(() => r() - 0.5)
    .map((t) => fitAt(t.short));
  const rp = seededRng(`${c.seed}-fa-pick-${c.year}`);
  const good = 7;
  const bad = 6;
  const contender = others.filter((f) => (f.off + f.def) / 2 >= good)[Math.floor(rp() * Math.max(1, others.filter((f) => (f.off + f.def) / 2 >= good).length))] ?? others[0];
  const payers = others.filter((f) => f.short !== contender?.short && (f.off + f.def) / 2 < bad);
  const payer = payers[Math.floor(rp() * Math.max(1, payers.length))] ?? others.find((f) => f.short !== contender?.short) ?? others[0];
  if (!contender || !payer) return [];
  const standAt = (short: string) => {
    const roster = needsRoster(c, ctx, short);
    const dc = C.depthChart({ name: c.name, pos: c.pos, ovr: c.ovr, age: c.age, rep: c.rep, contractStarter: false, lastRole: short === c.team ? c.lastRole : null }, roster);
    return { starter: dc.starter, behind: dc.ahead[dc.ahead.length - 1]?.name ?? null, label: dc.label };
  };
  const mk = (fit: C.Fit, perYear: number, yrs: number, pitch: string, kind: C.Offer['kind']): C.Offer => ({
    team: fit.short,
    fit,
    perYear: C.r10(clamp(perYear, K.MONEY[c.pos][0], K.MONEY[c.pos][1])),
    years: yrs,
    pitch,
    kind,
    stand: standAt(fit.short),
  });
  const home = c.fit as C.Fit;
  return [
    mk(home, value * (0.92 + r() * 0.1), years, 'Stay, and finish what he started here.', 'stay'),
    mk(contender, value * (0.68 + r() * 0.12), Math.max(1, years - 1), 'Less money. A real shot at a ring.', 'contender'),
    mk(payer, value * (1.12 + r() * 0.2), clamp(years + (c.age < 29 ? 1 : 0), 1, 6), 'Top of the market. A rebuild wants a face.', 'payer'),
  ];
}

export function signOffer(c: C.Career, offer: C.Offer, ctx: C.Ctx): C.Career {
  const change = offer.team !== c.team;
  const roster = change ? needsRoster(c, ctx, offer.team) : (c.roster as C.Roster);
  const fit = C.teamFit(ctx, offer.team, c.pos, roster, c.league, c.name);
  const extras = [offer.noTrade ? 'no-trade clause' : null, offer.starter ? 'starter guarantee' : null].filter(Boolean);
  return withCareer({
    ...c,
    team: offer.team,
    roster,
    kept: change && c.team && c.roster ? { ...c.kept, [c.team]: { roster: c.roster, yrs: rosterYrs(c) } } : c.kept,
    fit,
    offers: null,
    talks: null,
    lastRole: change ? null : c.lastRole,
    contract: { kind: change ? 'fa' : 'ext', years: offer.years, left: offer.years, perYear: offer.perYear, option: false, noTrade: !!offer.noTrade, starter: !!offer.starter },
    decisions: [...c.decisions, { year: c.year + 1, text: `${change ? 'Signed with' : 'Re-signed with'} the ${fit.name}: ${offer.years} yrs, $${offer.perYear}M a year${extras.length ? ` (${extras.join(', ')})` : ''}` }],
  });
}

export const ASKS = {
  money: { label: 'MORE MONEY', cost: [1, 2] as [number, number], hi: 0.3 },
  years: { label: 'ANOTHER YEAR', cost: [1, 2] as [number, number], hi: 0.35 },
  notrade: { label: 'NO-TRADE CLAUSE', cost: [2, 3] as [number, number], hi: 0.4 },
  starter: { label: 'STARTER GUARANTEE', cost: [1, 2] as [number, number], hi: 0.3 },
};

export function leverageOf(c: C.Career): number {
  const last = c.seasons.slice(-2);
  const perf = last.length ? last.reduce((s, x) => s + K.seasonScore(c.pos, { ...x.stats, wins: x.wins, award: x.award, champion: x.champion }), 0) / last.length : 0.3;
  return clamp(Math.round(perf * 3 + (c.rep >= 7 ? 1 : 0) - (c.age >= 32 ? 1 : 0) - (c.rep <= 3 ? 1 : 0)), 0, 4);
}

export function openTalks(c: C.Career, offer: C.Offer): C.Career {
  const lev = leverageOf(c);
  return { ...c, talks: { ...offer, base: offer.perYear, patience: 1 + lev, max: 1 + lev, asked: [], noTrade: false, starter: false, walked: false, lines: [] } };
}

export function ask(c: C.Career, kind: keyof typeof ASKS): C.Career {
  const t = c.talks;
  if (!t || t.walked) return c;
  const a = ASKS[kind];
  if (!a || (kind !== 'money' && t.asked.includes(kind)) || (kind === 'money' && t.asked.filter((k) => k === 'money').length >= 3)) return c;
  const r = seededRng(`${c.seed}-ask-${c.year}-${t.asked.length}-${kind}`);
  const again = kind === 'money' ? t.asked.filter((k) => k === 'money').length : 0;
  const p = clamp(a.hi + again * 0.2 - leverageOf(c) * 0.05, 0.1, 0.9);
  const big = r() < p;
  const patience = t.patience - (big ? a.hi : a.cost[0]);
  if (patience < 0) {
    const offers = (c.offers ?? []).filter((o) => o.team !== t.team);
    const fallback = offers.length
      ? offers
      : [{ ...t, perYear: C.r10((t.base ?? t.perYear) * 0.85), years: Math.max(1, t.years - 1), kind: 'late' as const, pitch: 'Late in free agency. The market moved on; this is what is left.', noTrade: false, starter: false }];
    return { ...c, offers: fallback, talks: { ...t, walked: true, patience: 0, lines: [...t.lines, 'The GM closes the folder. "We are done here."'] }, events: [...c.events, { year: c.year + 1, text: `Talks with the ${t.fit.name} collapsed over a ${a.label.toLowerCase()}.` }] };
  }
  const pushed = kind === 'money' ? C.r10(Math.max(t.perYear, Math.min(t.perYear * 1.08, K.MONEY[c.pos][1]))) : t.perYear;
  const years = kind === 'years' ? t.years + 1 : t.years;
  const tone = (big ? 'That one stung. ' : '') + (patience >= 2 ? 'A nod. "We can do that."' : patience === 1 ? '"Fine. But that is about it."' : 'A long pause. "Last one."');
  return { ...c, talks: { ...t, patience, perYear: pushed, years, noTrade: t.noTrade || kind === 'notrade', starter: t.starter || kind === 'starter', asked: [...t.asked, kind], lines: [...t.lines, tone] } };
}

export const closeTalks = (c: C.Career): C.Career => ({ ...c, talks: null });
export const acceptTalks = (c: C.Career, ctx: C.Ctx): C.Career => (c.talks && !c.talks.walked ? signOffer(c, c.talks, ctx) : c);

function offseason(c: C.Career, ctx: C.Ctx, season: C.SeasonRecord): C.Career {
  const r = seededRng(`${c.seed}-off-${c.year}`);
  const league = careerDrift(c, ctx, r);
  const { roster, moves } = rosterMoves({ ...c, league }, ctx, r);
  const gone = [...new Set([...(c.gone ?? [])])];
  let next: C.Career = { ...c, league, roster, gone, off: { step: 'recap', moves, news: [], camp: null, contract: false } };
  next = offseasonEvents(next, false, seededRng(`${c.seed}-ev-${c.year}`)).c;
  next = maybeShoeDeal(next);
  const offers = contractSituation(next, ctx);
  next = { ...next, fit: C.teamFit(ctx, next.team as string, next.pos, roster, league, next.name), offers, off: { step: 'recap', moves, news: newsFor(next, ctx, c.league, league), camp: null, contract: Array.isArray(offers) } };
  void season;
  return withCareer(next);
}

function newsFor(c: C.Career, ctx: C.Ctx, was: Record<string, { off: number; def: number }> | null, now: Record<string, { off: number; def: number }>): string[] {
  const before = (s: string) => {
    const d = was?.[s] ?? { off: 0, def: 0 };
    const t = C.teamOf(ctx, s);
    return t.off + t.def + d.off + d.def;
  };
  const after = (s: string) => {
    const t = C.teamOf(ctx, s);
    const d = now[s] ?? { off: 0, def: 0 };
    return t.off + t.def + d.off + d.def;
  };
  return ctx.teams
    .filter((t) => t.short !== c.team)
    .map((t) => ({ t, d: after(t.short) - before(t.short) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 3)
    .map(({ t, d }) => `The ${t.name} ${d > 0 ? (d > 2 ? 'reload: one of the big winners of the offseason' : 'get better on paper') : d < -2 ? 'lose a lot of talent. A long year ahead' : 'take a step back'}.`);
}

export function campDrill(c: C.Career, score: number, hit: boolean): C.Career {
  const won = !!hit;
  const chance = won ? clamp(0.25 + (score - 0.5), 0.25, 0.75) : 0;
  const bonus = won && seededRng(`${c.seed}-campdev-${c.year}`)() < chance ? 1 : 0;
  const legacy = won ? K.CAMP_LEGACY : 0;
  return withCareer({
    ...c,
    legacyBonus: c.legacyBonus + legacy,
    legacyCamp: c.legacyCamp + legacy,
    dev: { ...c.dev, points: c.dev.points + bonus },
    off: { ...(c.off as NonNullable<C.Career['off']>), camp: { score, won, bonus, legacy, game: 'camp' } },
  });
}

export function canUpgrade(c: C.Career, type: string): boolean {
  const ch = c.build[type];
  if (!ch) return false;
  const w = C.trainWindow(c.pos, c.age, type);
  if (w && !w.open) return false;
  if (C.maxedTrait(ch.val, ch, type)) return false;
  const cost = C.upgradeCost(ch.val, !!w?.late);
  return c.dev.points >= cost;
}

export function spendDev(c: C.Career, type: string): C.Career {
  if (!canUpgrade(c, type)) return c;
  const ch = c.build[type] as C.Trait;
  const w = C.trainWindow(c.pos, c.age, type);
  const cost = C.upgradeCost(ch.val, !!w?.late);
  const from = ch.val;
  const build = { ...c.build, [type]: C.gradeUp(ch, Math.min(11, Math.round(from) + 1)) };
  const ovr = ovrFromValues(Object.fromEntries(Object.entries(build).map(([t, v]) => [t, v.val])), c.pos);
  return withCareer({
    ...c,
    build,
    ovr,
    dev: { points: c.dev.points - cost, spent: c.dev.spent + cost },
    decisions: [...c.decisions, { year: c.year + 1, text: `Offseason work: ${type} ${from} -> ${from + 1}` }],
  });
}

export const bodyCost = (c: C.Career) => ((c.durability ?? 5) >= 8 ? 2 : 1);
export const canBodyWork = (c: C.Career) => (c.durability ?? 5) < K.BODY_MAX && c.dev.points >= bodyCost(c);

export function bodyWork(c: C.Career): C.Career {
  if (!canBodyWork(c)) return c;
  const cost = bodyCost(c);
  const from = c.durability ?? 5;
  const to = C.r10(Math.min(K.BODY_MAX, Math.floor(from) + 1));
  return withCareer({
    ...c,
    durability: to,
    durBase: Math.max(c.durBase ?? from, to),
    dev: { points: c.dev.points - cost, spent: c.dev.spent + cost },
    bodyWork: c.bodyWork + 1,
    decisions: [...c.decisions, { year: c.year + 1, text: `Offseason work: durability up to ${to}` }],
  });
}

export function nextSeason(c: C.Career, ctx: C.Ctx): C.Career {
  if (!c.contract || c.contract.left <= 0) return c;
  const r = seededRng(`${c.seed}-age-${c.year}`);
  const age = c.age + 1;
  const build = { ...c.build };
  const notes: string[] = [];
  const move = (t: string, d: number, why: string) => {
    const ch = build[t];
    if (!ch) return;
    const to = Math.round(ch.val) + d;
    if (to > 11 || to < 1) return;
    build[t] = { ...ch, val: to, ...(d > 0 ? { grew: (ch.grew ?? 0) + 1 } : { faded: (ch.faded ?? 0) + 1, slipY: c.year + 1 }) };
    notes.push(`${why}: ${t} down/up ${d}`);
  };
  const grows = Object.keys(c.build);
  if (age <= 24 && r() < 0.45) move(grows[Math.floor(r() * grows.length)] as string, 1, 'Still growing');
  else if (age <= 28 && r() < 0.2) move(grows[Math.floor(r() * grows.length)] as string, 1, 'A step forward');
  else if (age >= 29 && age <= 34 && r() < 0.1) {
    const mind = grows.filter((t) => !C.fadeOf(c.pos, t) && t !== 'size' && Math.round(build[t]?.val ?? 11) < 11);
    if (mind.length) move(mind[Math.floor(r() * mind.length)] as string, 1, 'Experience');
  }
  const phys = K.PHYSICAL[c.pos];
  const fell: string[] = [];
  const pickPhys = () => {
    const left = phys.filter((t) => !fell.includes(t));
    const list = left.length ? left : phys;
    return list[Math.floor(r() * list.length)] as string;
  };
  const F = C.fadeYear({ pos: c.pos, types: Object.keys(c.build), build, seed: c.seed, year: c.year + 1, age, durability: c.durability ?? 5, declineAt: K.AGE_DECLINE });
  for (const t of F.slipped) {
    fell.push(t);
    notes.push(`Father Time: ${t} down a grade`);
  }
  const agedBuild = F.build;
  for (const inj of c.injuries.filter((x) => x.year === c.year + 1 && (x.serious || x.games >= K.BIG_INJURY))) {
    if (r() < 0.6) {
      const t = pickPhys();
      const ch = agedBuild[t];
      if (ch && Math.round(ch.val) > 1) agedBuild[t] = { ...ch, val: Math.round(ch.val) - 1, faded: (ch.faded ?? 0) + 1 };
      notes.push(`The ${inj.kind}: ${t} down a grade`);
    }
  }
  if (age >= 26 && (c.durability ?? 5) <= 3 && r() < ((c.durability ?? 5) <= 2.2 ? 0.4 : 0.25)) {
    const t = pickPhys();
    const ch = agedBuild[t];
    if (ch && Math.round(ch.val) > 1) agedBuild[t] = { ...ch, val: Math.round(ch.val) - 1, faded: (ch.faded ?? 0) + 1 };
    notes.push(`Wear and tear: ${t} down a grade`);
  }
  const past = age - Math.max(29, K.AGE_DECLINE);
  const aged = past >= 0 ? (past >= 3 ? 0.2 : 0.1) : 0;
  const ovr = ovrFromValues(Object.fromEntries(Object.entries(agedBuild).map(([t, v]) => [t, v.val])), c.pos);
  const n: C.Career = {
    ...c,
    durability: aged ? C.r10(Math.max(1, (c.durability ?? 5) - aged)) : c.durability,
    durBase: aged ? C.r10(Math.max(1, c.durBase - aged)) : c.durBase,
    age,
    year: c.year + 1,
    season: c.season + 1,
    build: agedBuild,
    ovr,
    phase: 'preseason',
    offers: null,
    aging: notes,
    off: null,
  };
  return withCareer({ ...n, fit: C.teamFit(ctx, n.team as string, n.pos, n.roster as C.Roster, n.league, n.name) });
}

export const canRetire = (c: C.Career) => c.age >= 29 || c.seasons.length >= 8;

export function retireAge(c: C.Career): number {
  return K.RETIRE_AGE + (c.ovr >= 90 && (c.durability ?? 5) >= 7 ? 2 : 0);
}

export function retireReason(c: C.Career): string | null {
  if (c.age >= retireAge(c)) return 'age';
  if (c.seasons.length >= K.MAX_SEASONS) return 'seasons';
  if (Array.isArray(c.offers) && c.offers.length === 0) return 'nocalls';
  if (c.phase === 'offseason' && !c.talks && (c.contract?.left ?? 0) <= 0 && !c.offers) return c.seasons.length >= K.MAX_SEASONS ? 'seasons' : 'age';
  return null;
}

export function careerTotals(c: C.Career) {
  const stats: Record<string, number> = {};
  for (const s of c.seasons) {
    for (const [k, v] of Object.entries(s.stats)) {
      if (k === 'ppg' || k === 'rpg' || k === 'apg' || k === 'spg' || k === 'bpg' || k === 'gp') continue;
      stats[k] = (stats[k] ?? 0) + (v ?? 0);
    }
  }
  const games = c.seasons.reduce((a, s) => a + s.stats.gp, 0);
  stats.ppg = games ? C.r10((stats.pts ?? 0) / games) : 0;
  stats.rpg = games ? C.r10((stats.reb ?? 0) / games) : 0;
  stats.apg = games ? C.r10((stats.ast ?? 0) / games) : 0;
  return {
    seasons: c.seasons.length,
    games,
    wins: c.seasons.reduce((a, s) => a + s.wins, 0),
    losses: c.seasons.reduce((a, s) => a + s.losses, 0),
    playoffs: c.seasons.filter((s) => s.playoffs).length,
    rings: c.seasons.filter((s) => s.champion).length,
    awards: c.seasons.filter((s) => s.award).length,
    fmvps: c.seasons.filter((s) => s.fmvp).length,
    roy: c.seasons.some((s) => s.roy),
    proBowls: c.seasons.filter((s) => s.proBowl).length,
    allPros: c.seasons.filter((s) => s.allPro).length,
    records: 0,
    teams: [...new Set(c.seasons.map((s) => s.team))],
    stats,
    earnings: c.earnings,
  };
}

export function legacyOf(c: C.Career) {
  const t = careerTotals(c);
  const bonus = (c.legacyBonus ?? 0) + Math.min(K.EARN_LEGACY.max, Math.floor((c.earnings ?? 0) / K.EARN_LEGACY.per));
  const score = C.legacyScore(c, t, bonus);
  return { score, tier: C.legacyTier(score), totals: t, bonus };
}

export function hofProgress(c: C.Career): number {
  if (c.hof?.in) return 100;
  return Math.max(0, Math.min(99, Math.floor((legacyOf(c).score / K.HOF_LEGACY) * 100)));
}

export function retire(c: C.Career): C.Career {
  const L = legacyOf(c);
  const hof = C.hofVote(c.seed, L.score);
  return withCareer({
    ...c,
    phase: 'retired',
    retired: true,
    hof,
    offers: null,
    talks: null,
    active: null,
    decisions: [...c.decisions, { year: c.year + 1, text: `Retired at ${c.age} after ${c.seasons.length} seasons` }],
  });
}

export function canUnretire(c: C.Career): boolean {
  return c.phase === 'retired' && (c.seasons.length ?? 0) > 0;
}
