import * as v from 'valibot';
import { PickSchema } from '../data/schemas.js';
import { ATTRS_PER_BUILD, SALARY_CARDS, SQUAD_PLAYERS } from './types.js';

const ParticipantStatusSchema = v.picklist(['joined', 'building', 'ready', 'left']);

const NameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(16));
export const SecretSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/));
const ActionIdSchema = v.pipe(v.string(), v.uuid());

export const SettingsSchema = v.object({
  era: v.picklist(['current', 'alltime']),
  mode: v.picklist(['normal', 'salary', 'squad']),
});

export const BuildDraftSchema = v.object({
  position: v.picklist(['guard', 'big']),
  era: v.picklist(['current', 'alltime']),
  picks: v.pipe(
    v.record(v.pipe(v.string(), v.maxLength(32)), PickSchema),
    v.check((picks) => Object.keys(picks).length <= ATTRS_PER_BUILD, `A build has ${ATTRS_PER_BUILD} traits.`),
  ),
  spinIndex: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(64)),
  teamRespinUsed: v.boolean(),
  playerRespinUsed: v.boolean(),
  current: v.nullable(
    v.object({ team: v.pipe(v.string(), v.maxLength(32)), playerName: v.pipe(v.string(), v.maxLength(64)) }),
  ),
  team: v.nullable(v.pipe(v.string(), v.maxLength(16))),
  latest: v.optional(
    v.nullable(v.object({ attr: v.pipe(v.string(), v.maxLength(32)), playerName: v.pipe(v.string(), v.maxLength(64)) })),
    null,
  ),
});

const PicksSchema = v.pipe(
  v.record(v.pipe(v.string(), v.maxLength(32)), PickSchema),
  v.check((picks) => Object.keys(picks).length <= ATTRS_PER_BUILD, `A build has ${ATTRS_PER_BUILD} traits.`),
);

export const SpinRecordSchema = v.object({
  attr: v.pipe(v.string(), v.maxLength(32)),
  team: v.pipe(v.string(), v.maxLength(32)),
  playerName: v.pipe(v.string(), v.maxLength(64)),
  teamRespin: v.boolean(),
  playerRespin: v.boolean(),
});

const SpinsSchema = v.optional(v.pipe(v.array(SpinRecordSchema), v.maxLength(ATTRS_PER_BUILD)), []);

export const SalaryCardPickSchema = v.object({
  id: v.pipe(v.string(), v.maxLength(120)),
  name: v.pipe(v.string(), v.maxLength(64)),
  team: v.pipe(v.string(), v.maxLength(16)),
  price: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(200)),
  attrs: v.record(v.pipe(v.string(), v.maxLength(32)), v.number()),
  fullAttrs: v.record(v.pipe(v.string(), v.maxLength(32)), v.number()),
  posGroup: v.picklist(['guard', 'big']),
});

export const LobbyBuildSchema = v.variant('kind', [
  v.object({
    kind: v.literal('normal'),
    position: v.picklist(['guard', 'big']),
    era: v.picklist(['current', 'alltime']),
    picks: PicksSchema,
    spins: SpinsSchema,
  }),
  v.object({
    kind: v.literal('salary'),
    position: v.picklist(['guard', 'big']),
    cards: v.pipe(v.array(SalaryCardPickSchema), v.length(SALARY_CARDS)),
  }),
  v.object({
    kind: v.literal('squad'),
    players: v.pipe(
      v.array(
        v.object({
          slot: v.pipe(v.string(), v.maxLength(8)),
          position: v.picklist(['guard', 'big']),
          picks: PicksSchema,
          spins: SpinsSchema,
        }),
      ),
      v.length(SQUAD_PLAYERS),
    ),
  }),
]);

export const BuildSummarySchema = v.object({
  filled: v.number(),
  total: v.number(),
  latest: v.nullable(v.string()),
  ovr: v.number(),
  auto: v.optional(v.boolean(), false),
});

const SalaryPowersViewSchema = v.object({
  shuffle: v.boolean(),
  scout: v.boolean(),
  scouted: v.record(v.pipe(v.string(), v.maxLength(120)), v.string()),
});

const ParticipantSeasonSchema = v.object({
  wins: v.number(),
  losses: v.number(),
  seed: v.nullable(v.number()),
  finish: v.nullable(v.string()),
  champion: v.boolean(),
});

const ParticipantViewSchema = v.object({
  seat: v.number(),
  name: v.string(),
  isHost: v.boolean(),
  isMe: v.boolean(),
  away: v.boolean(),
  status: ParticipantStatusSchema,
  joinedAt: v.string(),
  lastSeen: v.string(),
  team: v.nullable(v.string()),
  rerollUsed: v.boolean(),
  build: v.nullable(LobbyBuildSchema),
  summary: v.nullable(BuildSummarySchema),
  buildSeed: v.nullable(v.string()),
  ready: v.boolean(),
  season: v.nullable(ParticipantSeasonSchema),
});

const EventViewSchema = v.object({
  id: v.number(),
  kind: v.string(),
  seat: v.nullable(v.number()),
  name: v.nullable(v.string()),
  detail: v.nullable(v.string()),
  at: v.string(),
});

const ParticipantProgressSchema = v.object({
  seat: v.number(),
  status: ParticipantStatusSchema,
  away: v.boolean(),
  summary: v.nullable(BuildSummarySchema),
  team: v.nullable(v.string()),
  ready: v.boolean(),
});

const TeamAssignmentSchema = v.object({
  seat: v.number(),
  name: v.string(),
  team: v.string(),
  rerollUsed: v.boolean(),
  isMe: v.boolean(),
});

const LeagueGameSchema = v.object({
  gameNo: v.number(),
  stage: v.number(),
  home: v.string(),
  away: v.string(),
  homeScore: v.number(),
  awayScore: v.number(),
  winner: v.string(),
  mine: v.boolean(),
  friends: v.boolean(),
});

const StandingSchema = v.object({
  team: v.string(),
  conference: v.picklist(['east', 'west']),
  wins: v.number(),
  losses: v.number(),
  seed: v.nullable(v.number()),
  isMine: v.boolean(),
  humanName: v.nullable(v.string()),
});

const SeriesGameSchema = v.object({
  index: v.number(),
  home: v.string(),
  away: v.string(),
  homeScore: v.number(),
  awayScore: v.number(),
  winner: v.string(),
});

const SeriesSchema = v.object({
  id: v.string(),
  round: v.number(),
  name: v.string(),
  conference: v.picklist(['east', 'west', 'finals']),
  high: v.string(),
  low: v.string(),
  highSeed: v.number(),
  lowSeed: v.number(),
  games: v.array(SeriesGameSchema),
  winner: v.nullable(v.string()),
  wins: v.number(),
  losses: v.number(),
  complete: v.boolean(),
});

const PlayInSchema = v.object({
  id: v.string(),
  conference: v.picklist(['east', 'west']),
  label: v.string(),
  home: v.string(),
  away: v.string(),
  homeScore: v.number(),
  awayScore: v.number(),
  winner: v.string(),
});

const AwardSchema = v.object({
  name: v.string(),
  team: v.string(),
  mine: v.boolean(),
  ppg: v.optional(v.number()),
  rpg: v.optional(v.number()),
  apg: v.optional(v.number()),
  spg: v.optional(v.number()),
  bpg: v.optional(v.number()),
});

const MyLeagueSchema = v.object({
  team: v.string(),
  wins: v.number(),
  losses: v.number(),
  seed: v.nullable(v.number()),
  madePlayoffs: v.nullable(v.boolean()),
  finish: v.nullable(v.string()),
  champion: v.nullable(v.boolean()),
  ppg: v.nullable(v.number()),
  rpg: v.nullable(v.number()),
  apg: v.nullable(v.number()),
  spg: v.nullable(v.number()),
  bpg: v.nullable(v.number()),
  mvp: v.boolean(),
  dpoy: v.boolean(),
});

const RecapEntrySchema = v.object({
  seat: v.number(),
  name: v.string(),
  team: v.string(),
  wins: v.number(),
  losses: v.number(),
  finish: v.string(),
  champion: v.boolean(),
});

const HeadToHeadSchema = v.object({
  a: v.string(),
  b: v.string(),
  wins: v.number(),
  losses: v.number(),
});

const RecapSchema = v.object({
  champion: v.string(),
  championName: v.string(),
  entries: v.array(RecapEntrySchema),
  h2h: v.array(HeadToHeadSchema),
});

const LeagueViewSchema = v.object({
  stage: v.number(),
  stageName: v.string(),
  phase: v.picklist(['season', 'awards', 'playin', 'playoffs', 'recap']),
  stageTotal: v.number(),
  cursor: v.number(),
  checkpoint: v.boolean(),
  games: v.array(LeagueGameSchema),
  standings: v.nullable(v.array(StandingSchema)),
  awards: v.nullable(v.object({ mvp: AwardSchema, dpoy: AwardSchema })),
  playin: v.nullable(v.array(PlayInSchema)),
  playoffs: v.nullable(v.array(SeriesSchema)),
  my: v.nullable(MyLeagueSchema),
  recap: v.nullable(RecapSchema),
});

const LeagueDeltaSchema = v.object({
  stage: v.number(),
  stageCursor: v.number(),
  checkpoint: v.boolean(),
  stageName: v.string(),
  stageTotal: v.number(),
  games: v.array(LeagueGameSchema),
  standings: v.optional(v.nullable(v.array(StandingSchema))),
  my: v.optional(v.nullable(MyLeagueSchema)),
  playoffs: v.optional(v.nullable(v.array(SeriesSchema))),
});

export const LobbyDeltaSchema = v.object({
  version: v.number(),
  serverTime: v.string(),
  participants: v.optional(v.array(ParticipantProgressSchema)),
  events: v.array(EventViewSchema),
  league: v.optional(LeagueDeltaSchema),
});

const ReadyViewSchema = v.object({
  ready: v.number(),
  present: v.number(),
  mine: v.boolean(),
});

const LobbyViewSchema = v.object({
  code: v.string(),
  phase: v.picklist(['lobby', 'draw', 'building', 'preview', 'season', 'awards', 'playin', 'playoffs', 'recap', 'rematch']),
  version: v.number(),
  settings: SettingsSchema,
  capacity: v.number(),
  seatsTaken: v.number(),
  hostSeat: v.nullable(v.number()),
  stage: v.number(),
  stageName: v.string(),
  stageTotal: v.number(),
  stageCursor: v.number(),
  checkpoint: v.boolean(),
  stageStartedAt: v.nullable(v.string()),
  participants: v.array(ParticipantViewSchema),
  me: ParticipantViewSchema,
  events: v.array(EventViewSchema),
  teams: v.array(TeamAssignmentSchema),
  salaryBoard: v.nullable(v.array(v.array(SalaryCardPickSchema))),
  salaryBudget: v.nullable(v.number()),
  salaryPowers: v.nullable(SalaryPowersViewSchema),
  league: v.nullable(LeagueViewSchema),
  ready: ReadyViewSchema,
  serverTime: v.string(),
});

export const ApiErrorSchema = v.object({
  error: v.string(),
  reason: v.picklist(['not_found', 'full', 'started', 'forbidden', 'conflict', 'invalid', 'server']),
});

export const CreateBodySchema = v.object({
  name: NameSchema,
  actionId: ActionIdSchema,
  settings: v.optional(SettingsSchema),
});

export const JoinBodySchema = v.object({
  name: NameSchema,
  actionId: ActionIdSchema,
});

export const StartBodySchema = v.object({
  actionId: ActionIdSchema,
  settings: SettingsSchema,
});

export const BuildBodySchema = v.object({
  actionId: ActionIdSchema,
  build: LobbyBuildSchema,
});

export const DraftBodySchema = v.object({
  actionId: ActionIdSchema,
  draft: BuildDraftSchema,
});

export const ActionBodySchema = v.object({
  actionId: ActionIdSchema,
});

export const StageBodySchema = v.object({
  actionId: ActionIdSchema,
  stage: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20)),
});

export const PowerBodySchema = v.variant('power', [
  v.object({
    actionId: ActionIdSchema,
    power: v.literal('shuffle'),
    target: v.variant('kind', [
      v.object({
        kind: v.literal('column'),
        index: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4)),
      }),
      v.object({
        kind: v.literal('row'),
        tier: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4)),
      }),
    ]),
  }),
  v.object({
    actionId: ActionIdSchema,
    power: v.literal('scout'),
    target: v.object({ cardId: v.pipe(v.string(), v.maxLength(120)) }),
  }),
]);

export const RemoveBodySchema = v.object({
  actionId: ActionIdSchema,
  seat: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(8)),
});

export const LobbyEnvelopeSchema = v.object({ lobby: LobbyViewSchema });
