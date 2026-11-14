import { LEAGUE_TEAMS, type HumanSeason, type LeagueResult } from '../shared/engine/league.js';
import {
  assembleLeagueView,
  stageGamesTotalFrom,
  type LeagueClock,
  type LeagueView,
} from '../shared/mp/league.js';
import {
  buildLeagueSlice,
  revealDataFromSlice,
  type LeagueSliceCheckpoint,
  type LeagueSliceGame,
  type LeagueSliceMeta,
} from '../shared/mp/leagueSlice.js';
import { db } from './db.js';

const META_INSERT = `
insert into league_slices (lobby_id, humans, east, west, clock, awards, playin, series, champion, h2h)
values ($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb)
on conflict (lobby_id) do update set
  humans = excluded.humans, east = excluded.east, west = excluded.west, clock = excluded.clock,
  awards = excluded.awards, playin = excluded.playin, series = excluded.series,
  champion = excluded.champion, h2h = excluded.h2h
`;

const GAME_INSERT = `
insert into league_slice_games (lobby_id, game_no, stage, home, away, home_score, away_score, winner, friends)
select $1::uuid,
  (entry->>0)::int, (entry->>1)::int, (entry->>2)::int, (entry->>3)::int,
  (entry->>4)::int, (entry->>5)::int, (entry->>6)::int, (entry->>7)::boolean
from jsonb_array_elements($2::jsonb) as entry
on conflict (lobby_id, game_no) do update set
  stage = excluded.stage, home = excluded.home, away = excluded.away,
  home_score = excluded.home_score, away_score = excluded.away_score,
  winner = excluded.winner, friends = excluded.friends
`;

const CHECKPOINT_INSERT = `
insert into league_slice_checkpoints (lobby_id, stage, cursor, visible, records)
select $1::uuid, (entry->>0)::int, (entry->>1)::int, (entry->>2)::int, entry->3
from jsonb_array_elements($2::jsonb) as entry
on conflict (lobby_id, stage, cursor) do update set
  visible = excluded.visible, records = excluded.records
`;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function missingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '42P01';
}

export async function writeLeagueSlice(lobbyId: string, league: LeagueResult): Promise<void> {
  const slice = buildLeagueSlice(league);
  const queries = [
    {
      text: META_INSERT,
      params: [
        lobbyId,
        JSON.stringify(slice.meta.humans),
        JSON.stringify(slice.meta.east),
        JSON.stringify(slice.meta.west),
        JSON.stringify(slice.meta.clock),
        JSON.stringify(slice.meta.awards),
        JSON.stringify(slice.meta.playin),
        JSON.stringify(slice.meta.series),
        slice.meta.champion,
        JSON.stringify(slice.meta.h2h),
      ],
    },
  ];
  for (const chunk of chunks(slice.games, 400)) {
    queries.push({
      text: GAME_INSERT,
      params: [
        lobbyId,
        JSON.stringify(
          chunk.map((game) => [
            game.gameNo,
            game.stage,
            game.home,
            game.away,
            game.homeScore,
            game.awayScore,
            game.winner,
            game.friends,
          ]),
        ),
      ],
    });
  }
  for (const chunk of chunks(slice.checkpoints, 300)) {
    queries.push({
      text: CHECKPOINT_INSERT,
      params: [
        lobbyId,
        JSON.stringify(chunk.map((checkpoint) => [checkpoint.stage, checkpoint.cursor, checkpoint.visible, checkpoint.records])),
      ],
    });
  }
  try {
    await db().batch(queries);
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

export interface LeagueSliceView {
  view: LeagueView;
  humans: HumanSeason[];
  clock: LeagueClock;
}

interface MetaRow {
  humans: HumanSeason[];
  east: [number, number, number, number | null][];
  west: [number, number, number, number | null][];
  clock: LeagueClock;
  awards: LeagueSliceMeta['awards'];
  playin: LeagueSliceMeta['playin'];
  series: LeagueSliceMeta['series'];
  champion: string | null;
  h2h: LeagueSliceMeta['h2h'];
}

const META_READ = `
select
  case when $2 < 4 then (
    select jsonb_agg(jsonb_build_array(h->>'participantId', h->>'team', h->>'name', (h->>'seat')::int))
    from jsonb_array_elements(humans) h
  ) else humans end as humans,
  clock,
  case when $2 >= 4 then east else null end as east,
  case when $2 >= 4 then west else null end as west,
  case when $2 >= 4 then awards else null end as awards,
  case when $2 >= 5 then playin else null end as playin,
  case when $2 >= 6 then series else null end as series,
  case when $2 >= 10 then champion else null end as champion,
  case when $2 >= 10 then h2h else null end as h2h
from league_slices where lobby_id = $1::uuid
`;

const CHECKPOINT_READ = `
select visible, records from league_slice_checkpoints
where lobby_id = $1::uuid and stage = $2 and cursor <= $3
order by cursor desc limit 1
`;

const GAMES_READ = `
select coalesce(json_agg(json_build_array(game_no, stage, home, away, home_score, away_score, winner, friends) order by game_no), '[]'::json) as games
from league_slice_games
where lobby_id = $1::uuid and game_no <= $2
  and (
    game_no > $2 - 30
    or home = $3 or away = $3
    or game_no in (
      select game_no from league_slice_games
      where lobby_id = $1::uuid and game_no <= $2 and friends
      order by game_no desc limit 20
    )
  )
`;

export async function readLeagueClock(lobbyId: string): Promise<LeagueClock | null> {
  try {
    const rows = await db().query<{ clock: LeagueClock }>('select clock from league_slices where lobby_id = $1::uuid', [lobbyId]);
    return rows[0]?.clock ?? null;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function readLeagueView(
  lobbyId: string,
  stage: number,
  cursor: number,
  meParticipantId: string,
): Promise<LeagueSliceView | null> {
  let metaRows: MetaRow[];
  try {
    metaRows = await db().query<MetaRow>(META_READ, [lobbyId, stage]);
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  const meta = metaRows[0];
  if (!meta) return null;
  const clock = meta.clock;
  const humans =
    stage < 4
      ? (meta.humans as unknown as [string, string, string, number][]).map((row) => ({
          participantId: row[0],
          team: row[1],
          name: row[2],
          seat: row[3],
        })) as HumanSeason[]
      : meta.humans;
  const total = stageGamesTotalFrom(clock, stage);
  const clamped = Math.max(0, Math.min(Number(cursor), total));
  let checkpoint: LeagueSliceCheckpoint | null = null;
  if (stage < 4) {
    const rows = await db().query<{ visible: number; records: LeagueSliceCheckpoint['records'] }>(CHECKPOINT_READ, [
      lobbyId,
      stage,
      clamped,
    ]);
    if (rows[0]) checkpoint = { stage, cursor: clamped, visible: Number(rows[0].visible), records: rows[0].records };
  }
  const meTeam = humans.find((entry) => entry.participantId === meParticipantId)?.team ?? null;
  const meIndex = meTeam ? LEAGUE_TEAMS.indexOf(meTeam) : -1;
  const prefix = clock.counts.slice(0, Math.min(stage, 4)).reduce((sum, count) => sum + count, 0);
  const revealed = stage >= 4 ? clock.counts.reduce((sum, count) => sum + count, 0) : prefix + clamped;
  const gameRows = await db().query<{ games: [number, number, number, number, number, number, number, boolean][] }>(GAMES_READ, [
    lobbyId,
    revealed,
    meIndex,
  ]);
  const games: LeagueSliceGame[] = (gameRows[0]?.games ?? []).map((row) => ({
    gameNo: row[0],
    stage: row[1],
    home: row[2],
    away: row[3],
    homeScore: row[4],
    awayScore: row[5],
    winner: row[6],
    friends: row[7],
  }));
  const data = revealDataFromSlice(
    {
      humans,
      east: meta.east,
      west: meta.west,
      clock,
      awards: meta.awards,
      playin: meta.playin,
      series: meta.series,
      champion: meta.champion,
      h2h: meta.h2h,
    },
    games,
    checkpoint,
    stage,
  );
  return { view: assembleLeagueView(data, stage, Number(cursor), meParticipantId), humans, clock };
}
