import * as v from 'valibot';

export const PlayerSchema = v.object({
  name: v.string(),
  short: v.string(),
  team: v.string(),
  starter: v.optional(v.boolean()),
  captain: v.optional(v.boolean()),
  number: v.optional(v.union([v.number(), v.string()])),
  height: v.optional(v.number()),
  weight: v.optional(v.number()),
  wingspan: v.optional(v.number()),
  skin: v.optional(v.string()),
  position: v.optional(v.string()),
  posGroup: v.optional(v.string()),
  legend: v.optional(v.boolean()),
  years: v.optional(v.string()),
  attrs: v.record(v.string(), v.number()),
});

export const TeamSchema = v.object({
  short: v.string(),
  name: v.string(),
  color: v.string(),
  color2: v.string(),
});

export const PlayerListSchema = v.array(PlayerSchema);
export const SalaryLegendSchema = v.object({
  name: v.string(),
  team: v.string(),
  short: v.optional(v.string()),
  posGroup: v.optional(v.string()),
  legend: v.optional(v.boolean()),
  number: v.optional(v.union([v.number(), v.string()])),
  height: v.optional(v.number()),
  weight: v.optional(v.number()),
  position: v.optional(v.string()),
  starter: v.optional(v.boolean()),
  attrs: v.record(v.string(), v.number()),
});
export const SalaryLegendListSchema = v.array(SalaryLegendSchema);
export const TeamListSchema = v.array(TeamSchema);
export const HeadshotSchema = v.record(v.string(), v.string());

export const PickSchema = v.object({
  attr: v.pipe(v.string(), v.maxLength(32)),
  val: v.number(),
  playerName: v.pipe(v.string(), v.maxLength(64)),
  playerShort: v.pipe(v.string(), v.maxLength(32)),
  team: v.pipe(v.string(), v.maxLength(32)),
  number: v.optional(v.union([v.number(), v.string()])),
  photo: v.optional(v.string()),
  height: v.optional(v.number()),
  weight: v.optional(v.number()),
});

export const BuildSchema = v.object({
  position: v.picklist(['guard', 'big']),
  era: v.picklist(['current', 'alltime']),
  picks: v.record(v.string(), PickSchema),
});

export const StandingSchema = v.object({
  short: v.string(),
  wins: v.number(),
  isUs: v.optional(v.boolean()),
});

export const GameLineSchema = v.object({
  g: v.number(),
  won: v.boolean(),
  home: v.boolean(),
  opponent: v.string(),
  mySc: v.number(),
  oppSc: v.number(),
  pts: v.number(),
  reb: v.number(),
  ast: v.number(),
});

export const AwardSchema = v.object({
  name: v.string(),
  short: v.string(),
  team: v.optional(v.string()),
  ppg: v.optional(v.number()),
  rpg: v.optional(v.number()),
  apg: v.optional(v.number()),
  spg: v.optional(v.number()),
  bpg: v.optional(v.number()),
  isPlayer: v.optional(v.boolean()),
});

export const SeasonSchema = v.object({
  ovr: v.number(),
  archetype: v.optional(v.string()),
  wins: v.number(),
  losses: v.number(),
  position: v.picklist(['guard', 'big']),
  ppg: v.number(),
  rpg: v.number(),
  apg: v.number(),
  spg: v.number(),
  bpg: v.number(),
  tov: v.number(),
  fgPct: v.number(),
  threePct: v.number(),
  ftPct: v.number(),
  per: v.number(),
  games: v.array(GameLineSchema),
  gameLog: v.array(v.string()),
  bestGame: v.nullable(GameLineSchema),
  conference: v.picklist(['east', 'west']),
  seed: v.number(),
  madePlayoffs: v.boolean(),
  standings: v.array(StandingSchema),
  playoffRounds: v.array(v.unknown()),
  champion: v.boolean(),
  team: v.string(),
  mvp: v.boolean(),
  dpoy: v.boolean(),
  finalsOpp: v.nullable(v.string()),
  finalsSeries: v.nullable(v.string()),
  displayMvp: AwardSchema,
  displayDpoy: AwardSchema,
  goatRank: v.nullable(v.number()),
});

export const RunSchema = v.object({
  v: v.literal(1),
  seed: v.string(),
  position: v.picklist(['guard', 'big']),
  era: v.picklist(['current', 'alltime']),
  picks: v.record(v.string(), PickSchema),
  spinIndex: v.number(),
  teamRespinUsed: v.boolean(),
  playerRespinUsed: v.boolean(),
  current: v.nullable(v.object({ team: v.string(), playerName: v.string() })),
  team: v.nullable(v.string()),
  season: v.nullable(SeasonSchema),
  draft: v.nullable(
    v.object({
      v: v.literal(1),
      team: v.string(),
      position: v.picklist(['guard', 'big']),
      era: v.picklist(['current', 'alltime']),
      attrs: v.record(v.string(), v.number()),
      mods: v.object({ off: v.number(), def: v.number() }),
      ovr: v.number(),
      winProb: v.number(),
      rolled: v.any(),
      games: v.array(GameLineSchema),
      sat: v.array(v.number()),
      satUntil: v.number(),
      pending: v.nullable(v.any()),
      stops: v.array(v.number()),
      stopIndex: v.number(),
      decisions: v.array(v.any()),
      phase: v.picklist(['moment', 'done']),
    }),
  ),
  moment: v.nullable(
    v.object({
      id: v.string(),
      kicker: v.string(),
      title: v.string(),
      body: v.string(),
      stop: v.number(),
      options: v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          flavor: v.optional(v.string()),
          effect: v.any(),
        }),
      ),
    }),
  ),
  screen: v.picklist(['builder', 'team', 'season', 'playoffs', 'end']),
});

export type Run = v.InferOutput<typeof RunSchema>;
