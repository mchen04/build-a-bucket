create table if not exists lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_participant uuid,
  phase text not null default 'lobby',
  settings jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  playoffs_started_at timestamptz,
  rounds_revealed int not null default 0,
  season_secret text not null default gen_random_uuid()::text,
  create_action uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lobbies_phase_check check (phase in ('lobby', 'building', 'season', 'barrier', 'playoffs', 'finished'))
);

alter table lobbies add column if not exists settings jsonb not null default '{}'::jsonb;
alter table lobbies add column if not exists playoffs_started_at timestamptz;
alter table lobbies add column if not exists rounds_revealed int not null default 0;
alter table lobbies add column if not exists season_secret text not null default gen_random_uuid()::text;
alter table lobbies add column if not exists create_action uuid;

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
  constraint participants_status_check check (
    status in ('joined', 'building', 'qualified', 'eliminated', 'playoffs', 'done', 'left')
  ),
  constraint participants_seat_check check (seat between 1 and 8),
  unique (lobby_id, seat),
  unique (lobby_id, token_hash)
);

alter table participants drop column if exists playoffs;
alter table participants drop constraint if exists participants_status_check;
alter table participants add constraint participants_status_check check (
  status in ('joined', 'building', 'qualified', 'eliminated', 'playoffs', 'done', 'left')
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
