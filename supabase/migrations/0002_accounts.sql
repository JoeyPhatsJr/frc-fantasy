-- 0002_accounts.sql — v2 SP1: accounts & leagues (v2 spec §4, §8.2).
-- Run AFTER scripts/delete-v1-leagues.ts has removed the v1 demo/test leagues (spec §4.7).
-- Additive: v1 code keeps working while a deploy is in progress (every new NOT NULL column has a default).

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  avatar_url    text,
  frc_team      integer check (frc_team between 1 and 99999),
  created_at    timestamptz not null default now()
);
alter table profiles enable row level security;   -- on, with no policies, like every table (spec §8.1)

alter table players
  add column user_id  uuid references profiles(id) on delete set null,
  add column role     text not null default 'player' check (role in ('commissioner', 'player'));
create unique index players_league_user on players (league_id, user_id) where user_id is not null;
create index players_user_idx on players (user_id) where user_id is not null;

-- 6 characters, no 0/O/1/I/L (spec §4.4). The app retries on the rare collision.
create function gen_invite_code() returns text
language sql volatile
as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6)
$$;
revoke execute on function gen_invite_code() from public, anon, authenticated;
grant execute on function gen_invite_code() to service_role;

alter table leagues
  add column invite_code  text not null default gen_invite_code(),
  add column visibility   text not null default 'link' check (visibility in ('link', 'members')),
  add column created_by   uuid references profiles(id) on delete set null,
  alter column admin_token_hash drop not null;       -- dropped entirely in 0006_cleanup.sql
alter table leagues add constraint leagues_invite_code_key unique (invite_code);
create index leagues_created_by_idx on leagues (created_by);
