create table leagues (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  name              text not null check (char_length(name) between 1 and 80),
  admin_token_hash  text not null,
  home_team_number  integer not null default 5181,
  default_scoring   jsonb not null,
  created_at        timestamptz not null default now(),
  constraint leagues_slug_key unique (slug)
);

create table players (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  created_at  timestamptz not null default now()
);
create unique index players_league_name_ci on players (league_id, lower(name));

create table rounds (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  event_key     text not null check (event_key ~ '^[0-9]{4}[a-z0-9]+$'),
  event_name    text not null,
  start_date    date not null,
  end_date      date not null,
  timezone      text not null default 'America/New_York',
  roster_size   integer not null default 4 check (roster_size between 1 and 10),
  draft_order   uuid[] not null default '{}',
  scoring       jsonb not null,
  finalized_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint rounds_league_event_key unique (league_id, event_key)
);

create table round_extra_teams (
  round_id  uuid not null references rounds(id) on delete cascade,
  team_key  text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  primary key (round_id, team_key)
);

create table picks (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  pick_number  integer not null check (pick_number >= 0),
  player_id    uuid not null references players(id) on delete cascade,
  team_key     text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  created_at   timestamptz not null default now(),
  constraint picks_round_pick_number_key unique (round_id, pick_number),
  constraint picks_round_team_key unique (round_id, team_key)
);

create table adjustments (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references rounds(id) on delete cascade,
  player_id   uuid references players(id) on delete cascade,
  team_key    text check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  points      integer not null check (points between -1000 and 1000),
  reason      text not null check (char_length(reason) between 1 and 200),
  created_at  timestamptz not null default now(),
  check ((player_id is null) <> (team_key is null))
);

create table tba_cache (
  path          text primary key,
  etag          text,
  body          jsonb,
  fetched_at    timestamptz not null,
  last_error    text,
  last_error_at timestamptz
);

create index players_league_idx on players (league_id);
create index rounds_league_idx on rounds (league_id);
create index picks_round_idx on picks (round_id);
create index adjustments_round_idx on adjustments (round_id);

-- RLS on, no policies: the anon key can read and write nothing (spec §6.3).
-- The server uses the service role key, which bypasses RLS.
alter table leagues            enable row level security;
alter table players            enable row level security;
alter table rounds             enable row level security;
alter table round_extra_teams  enable row level security;
alter table picks              enable row level security;
alter table adjustments        enable row level security;
alter table tba_cache          enable row level security;
