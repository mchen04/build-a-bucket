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
alter table lobbies add column if not exists stage int not null default 0;
alter table lobbies add column if not exists stage_cursor int not null default 0;
alter table lobbies add column if not exists stage_started_at timestamptz;
alter table lobbies add column if not exists locked_at timestamptz;
alter table lobbies add column if not exists rematch int not null default 0;

update lobbies set phase = 'lobby' where phase not in ('lobby', 'draw', 'building', 'preview', 'season', 'awards', 'playin', 'playoffs', 'recap');
alter table lobbies drop constraint if exists lobbies_phase_check;
alter table lobbies add constraint lobbies_phase_check check (
  phase in ('lobby', 'draw', 'building', 'preview', 'season', 'awards', 'playin', 'playoffs', 'recap')
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
update participants set status = case when status = 'left' then 'left' else 'joined' end
  where status not in ('joined', 'building', 'ready', 'left');
alter table participants drop constraint if exists participants_status_check;
alter table participants add constraint participants_status_check check (
  status in ('joined', 'building', 'ready', 'left')
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

create table if not exists league_games (
  lobby_id uuid not null references lobbies (id) on delete cascade,
  game_no int not null,
  kind text not null,
  stage int not null,
  home text not null,
  away text not null,
  home_score int not null,
  away_score int not null,
  winner text not null,
  primary key (lobby_id, game_no)
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

create unique index if not exists lobbies_create_action_idx on lobbies (create_action);
create index if not exists participants_lobby_seat_idx on participants (lobby_id, seat);
create index if not exists events_lobby_idx on events (lobby_id, id desc);
create index if not exists lobbies_updated_idx on lobbies (updated_at);
create index if not exists actions_lobby_idx on actions (lobby_id);
create index if not exists lobby_teams_lobby_idx on lobby_teams (lobby_id);
create index if not exists league_games_lobby_idx on league_games (lobby_id, game_no);
