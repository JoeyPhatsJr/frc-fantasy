-- 0004_team_stats.sql — SP3 (spec §5.6, §6.1). Additive only: the previous deploy keeps working.
-- event_scores and team_stats are DERIVED caches. They can be truncated at any time and rebuild
-- themselves (scripts/rebuild-event-scores.ts, scripts/build-team-stats.ts).

-- sha256 of the canonical JSON of tba_cache.body; null when body is null. Written by the app's
-- upsertCache, never by callers. Existing rows are filled by scripts/backfill-body-hash.ts.
alter table tba_cache add column body_hash text;

create table event_scores (
  event_key     text not null check (event_key ~ '^[0-9]{4}[a-z0-9]+$'),
  config_hash   text not null,   -- sha256 of canonical (sorted-key) JSON of the ScoringConfig
  source_stamp  text not null,   -- sha256 of the six input paths' body_hash values, in fixed path order
  scores        jsonb not null,  -- serialized EventScores: { teams: { [teamKey]: { teamKey, total, lines } }, qualsComplete, rpMethod }
  info          jsonb not null default '{}',  -- { teamNames, hasEventData, hasRankings } for the round page
  computed_at   timestamptz not null default now(),
  primary key (event_key, config_hash)
);

create table team_stats (
  team_key          text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  season            integer not null check (season between 1992 and 2100),
  events_played     integer not null,          -- events with >= 1 played qual match for this team
  total_points      integer not null,          -- fantasy points over those events, DEFAULT_SCORING
  qual_wins         integer not null,
  qual_losses       integer not null,
  qual_ties         integer not null,
  best_finish       text check (best_finish in ('winner', 'finalist', 'captain', 'picked')),  -- null = not picked
  awards            jsonb not null default '[]',   -- [{ "type": 0, "name": "Impact Award", "eventKey": "2026paca" }]
  events            jsonb not null default '[]',   -- [{ "eventKey", "name", "endDate", "rank", "finish", "points" }]
  latest_event_key  text,
  latest_opr        numeric(6, 1),
  latest_rank       integer,
  updated_at        timestamptz not null default now(),
  primary key (team_key, season)
);
create index team_stats_season_idx on team_stats (season);

alter table event_scores enable row level security;
alter table team_stats   enable row level security;
