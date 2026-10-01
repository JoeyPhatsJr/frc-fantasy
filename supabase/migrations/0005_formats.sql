-- 0005_formats.sql — SP2 league formats (spec §5.1–§5.4, §8.2).
-- Additive: every new NOT NULL column has a default, so the SP3 deploy keeps working during this deploy.
-- Safe to re-run (every column and table is "if not exists", every named constraint is dropped
-- before it is re-added), e.g. after a partial paste in the SQL Editor.

-- §5.1 league format (fixed at creation) + follow-a-team sync stamp
alter table leagues
  add column if not exists format             text not null default 'event' check (format in ('event', 'season')),
  add column if not exists follows_synced_at  timestamptz;

-- §5.2 round kinds
alter table rounds
  add column if not exists kind         text not null default 'tba' check (kind in ('tba', 'manual', 'season')),
  alter column event_key  drop not null,
  add column if not exists season_year  integer check (season_year between 1992 and 2100),
  add column if not exists pool_filter  jsonb,                  -- season rounds only (§5.5)
  add column if not exists auto_added   boolean not null default false;

alter table rounds drop constraint if exists rounds_kind_event_key;
alter table rounds add constraint rounds_kind_event_key check ((kind = 'tba') = (event_key is not null));
alter table rounds drop constraint if exists rounds_kind_season;
alter table rounds add constraint rounds_kind_season    check ((kind = 'season') = (season_year is not null));

-- v1's inline check (0001_init.sql:28) got Postgres's auto-generated name rounds_roster_size_check.
-- Before applying to production, confirm the name:
--   select conname from pg_constraint where conrelid = 'rounds'::regclass and contype = 'c';
alter table rounds drop constraint if exists rounds_roster_size_check;
alter table rounds add constraint rounds_roster_size_check check (roster_size between 1 and 15);

-- §5.3 manual results
create table if not exists manual_results (
  round_id        uuid not null references rounds(id) on delete cascade,
  team_key        text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  qual_wins       integer not null default 0 check (qual_wins between 0 and 50),
  qual_losses     integer not null default 0 check (qual_losses between 0 and 50),
  qual_ties       integer not null default 0 check (qual_ties between 0 and 50),
  ranking_points  integer check (ranking_points between 0 and 500),     -- null = unknown
  qual_rank       integer check (qual_rank between 1 and 200),          -- null = unknown
  alliance_role   text check (alliance_role in ('captain', 'pick1', 'pick2', 'pick3', 'backup')),
  playoff_wins    integer not null default 0 check (playoff_wins between 0 and 20),
  event_result    text check (event_result in ('winner', 'finalist')),
  award_types     integer[] not null default '{}',                      -- TBA award type ids
  primary key (round_id, team_key)
);

-- §5.4 follow-a-team
create table if not exists league_follows (
  league_id    uuid not null references leagues(id) on delete cascade,
  team_number  integer not null check (team_number between 1 and 99999),
  primary key (league_id, team_number)
);
create table if not exists league_skipped_events (
  league_id  uuid not null references leagues(id) on delete cascade,
  event_key  text not null,
  primary key (league_id, event_key)
);

-- Global rule: RLS on, no policies, for every table.
alter table manual_results         enable row level security;
alter table league_follows         enable row level security;
alter table league_skipped_events  enable row level security;
