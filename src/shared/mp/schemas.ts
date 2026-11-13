import * as v from 'valibot';
import { PickSchema } from '../data/schemas.js';
import { ATTRS_PER_BUILD } from './types.js';

const ParticipantStatusSchema = v.picklist([
  'joined',
  'building',
  'qualified',
  'eliminated',
  'playoffs',
  'done',
  'left',
]);

const NameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(16));
export const SecretSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/));
const ActionIdSchema = v.pipe(v.string(), v.uuid());

export const SettingsSchema = v.object({
  era: v.picklist(['current', 'alltime']),
  positions: v.pipe(v.array(v.picklist(['guard', 'big'])), v.minLength(1), v.maxLength(2)),
  revealSeconds: v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(30)),
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

const BuildSummarySchema = v.object({
  filled: v.number(),
  total: v.number(),
  latest: v.nullable(v.string()),
});

const SeasonSummarySchema = v.object({
  wins: v.number(),
  losses: v.number(),
  ovr: v.number(),
  seed: v.number(),
  ppg: v.number(),
  rpg: v.number(),
  apg: v.number(),
  madePlayoffs: v.boolean(),
  champion: v.boolean(),
  archetype: v.string(),
  team: v.string(),
  qualified: v.boolean(),
  finishRank: v.nullable(v.number()),
  finishLabel: v.nullable(v.string()),
});

const RoundViewSchema = v.object({
  name: v.string(),
  opponent: v.string(),
  won: v.boolean(),
  wins: v.number(),
  losses: v.number(),
  label: v.nullable(v.string()),
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
  build: v.nullable(BuildDraftSchema),
  summary: v.nullable(BuildSummarySchema),
  season: v.nullable(SeasonSummarySchema),
  rounds: v.array(RoundViewSchema),
  roundsTotal: v.number(),
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
});

export const LobbyDeltaSchema = v.object({
  version: v.number(),
  serverTime: v.string(),
  participants: v.array(ParticipantProgressSchema),
  events: v.array(EventViewSchema),
});

const StandingEntrySchema = v.object({
  seat: v.number(),
  name: v.string(),
  isMe: v.boolean(),
  record: v.string(),
  ovr: v.number(),
  finishLabel: v.nullable(v.string()),
});

const LobbyViewSchema = v.object({
  code: v.string(),
  phase: v.picklist(['lobby', 'building', 'season', 'barrier', 'playoffs', 'finished']),
  version: v.number(),
  settings: SettingsSchema,
  capacity: v.number(),
  seatsTaken: v.number(),
  hostSeat: v.nullable(v.number()),
  playoffsStartedAt: v.nullable(v.string()),
  revealSeconds: v.number(),
  roundsRevealed: v.number(),
  roundsTotal: v.number(),
  participants: v.array(ParticipantViewSchema),
  me: ParticipantViewSchema,
  events: v.array(EventViewSchema),
  standings: v.nullable(v.array(StandingEntrySchema)),
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

export const DraftBodySchema = v.object({
  actionId: ActionIdSchema,
  draft: BuildDraftSchema,
});

export const ActionBodySchema = v.object({
  actionId: ActionIdSchema,
});

export const ReleaseBodySchema = v.object({
  actionId: ActionIdSchema,
  force: v.optional(v.boolean(), false),
});

export const LobbyEnvelopeSchema = v.object({ lobby: LobbyViewSchema });
