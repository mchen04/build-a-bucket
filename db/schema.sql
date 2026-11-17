create table if not exists lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_participant uuid,
  phase text not null default 'lobby',
  settings jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  season_secret text not null default gen_random_uuid()::text,
  create_action uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table lobbies add column if not exists settings jsonb not null default '{}'::jsonb;
alter table lobbies add column if not exists season_secret text not null default gen_random_uuid()::text;
alter table lobbies add column if not exists create_action uuid;
alter table lobbies add column if not exists mode text not null default 'normal';
alter table lobbies add column if not exists era text not null default 'current';
alter table lobbies add column if not exists league jsonb;
alter table lobbies add column if not exists league_version bigint not null default 0;
update lobbies set league_version = version where league is not null and league_version = 0;
alter table lobbies add column if not exists stage int not null default 0;
alter table lobbies add column if not exists stage_cursor int not null default 0;
alter table lobbies add column if not exists stage_started_at timestamptz;
alter table lobbies add column if not exists locked_at timestamptz;
alter table lobbies add column if not exists league_claimed_at timestamptz;
alter table lobbies add column if not exists rematch int not null default 0;

alter table lobbies drop constraint if exists lobbies_phase_check;
update lobbies set phase = 'lobby'
  where phase = 'building' and league is null and locked_at is null and settings = '{}'::jsonb;
update lobbies set phase = 'recap'
  where phase in ('season', 'barrier', 'playoffs', 'finished') and league is null;
alter table lobbies add constraint lobbies_phase_check check (
  phase in (
    'lobby', 'draw', 'building', 'preview', 'season', 'awards', 'playin', 'playoffs', 'recap', 'rematch',
    'barrier', 'finished'
  )
);
alter table lobbies drop constraint if exists lobbies_mode_check;
alter table lobbies add constraint lobbies_mode_check check (mode in ('normal', 'salary', 'squad'));

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references lobbies (id) on delete cascade,
  token_hash text not null,
  name text not null,
  seat int not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  status text not null default 'joined',
  build jsonb,
  season jsonb,
  constraint participants_seat_check check (seat between 1 and 8),
  unique (lobby_id, seat),
  unique (lobby_id, token_hash)
);

alter table participants add column if not exists team text;
alter table participants add column if not exists ready_stage int not null default -1;
alter table participants add column if not exists build_kind text;
alter table participants add column if not exists squad jsonb;
alter table participants add column if not exists build_summary jsonb;
alter table participants add column if not exists preview_ready boolean not null default false;
alter table participants add column if not exists salary_powers jsonb;

update participants set status = 'joined' where status in ('qualified', 'eliminated', 'playoffs', 'done');
update participants p set
  build = null,
  build_kind = null,
  squad = null,
  build_summary = null,
  status = 'joined',
  ready_stage = -1,
  preview_ready = false,
  salary_powers = null
where p.lobby_id in (select id from lobbies where league is null and phase in ('lobby', 'recap'));

alter table participants drop constraint if exists participants_status_check;
alter table participants add constraint participants_status_check check (
  status in ('joined', 'building', 'ready', 'left', 'qualified', 'eliminated', 'playoffs', 'done')
);

create table if not exists lobby_teams (
  lobby_id uuid not null references lobbies (id) on delete cascade,
  participant_id uuid not null references participants (id) on delete cascade,
  team text not null,
  reroll_used boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (lobby_id, participant_id),
  unique (lobby_id, team)
);

create table if not exists events (
  id bigserial primary key,
  lobby_id uuid not null references lobbies (id) on delete cascade,
  participant_id uuid,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists actions (
  participant_id uuid not null,
  action_id uuid not null,
  lobby_id uuid not null references lobbies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (participant_id, action_id)
);

drop table if exists league_games;

create unique index if not exists lobbies_create_action_idx on lobbies (create_action);
create index if not exists participants_lobby_seat_idx on participants (lobby_id, seat);
create index if not exists events_lobby_idx on events (lobby_id, id desc);
create index if not exists lobbies_updated_idx on lobbies (updated_at);
create index if not exists actions_lobby_idx on actions (lobby_id);
create index if not exists lobby_teams_lobby_idx on lobby_teams (lobby_id);

create table if not exists league_slices (
  lobby_id uuid primary key references lobbies (id) on delete cascade,
  humans jsonb not null,
  east jsonb not null,
  west jsonb not null,
  clock jsonb not null,
  awards jsonb,
  playin jsonb,
  series jsonb,
  champion text,
  h2h jsonb
);

create table if not exists league_slice_games (
  lobby_id uuid not null references lobbies (id) on delete cascade,
  game_no int not null,
  stage int not null,
  home smallint not null,
  away smallint not null,
  home_score int not null,
  away_score int not null,
  winner smallint not null,
  friends boolean not null default false,
  primary key (lobby_id, game_no)
);

create table if not exists league_slice_checkpoints (
  lobby_id uuid not null references lobbies (id) on delete cascade,
  stage int not null,
  cursor int not null,
  visible int not null,
  records jsonb not null,
  primary key (lobby_id, stage, cursor)
);

create index if not exists league_slice_games_home_idx on league_slice_games (lobby_id, home, game_no);
create index if not exists league_slice_games_away_idx on league_slice_games (lobby_id, away, game_no);
create index if not exists league_slice_games_friends_idx on league_slice_games (lobby_id, friends, game_no desc);
