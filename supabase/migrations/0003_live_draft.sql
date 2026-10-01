-- FRC Fantasy v2 · SP4 live draft room (spec §7, §8.2). Additive: v1/SP1 code keeps working.

alter table rounds
  add column draft_mode           text not null default 'commissioner' check (draft_mode in ('commissioner', 'live')),
  add column pick_seconds         integer check (pick_seconds in (30, 60, 90, 120)),   -- null = no timer
  add column draft_started_at     timestamptz,
  add column draft_paused_at      timestamptz,          -- non-null = paused
  add column paused_remaining_ms  integer,              -- remaining time when paused (timer only); null = full timer on resume
  add column pick_deadline        timestamptz;          -- current pick's deadline; null if no timer, paused, not started, or done

alter table picks
  add column auto  boolean not null default false;      -- true when made by tick/advance (undo uses it, §7.3)

create table draft_queue (
  round_id   uuid not null references rounds(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  team_key   text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  position   integer not null check (position >= 0),
  primary key (round_id, player_id, team_key)
);
create index draft_queue_player_idx on draft_queue (round_id, player_id, position);

create table draft_prefs (
  round_id   uuid not null references rounds(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  autodraft  boolean not null default false,
  primary key (round_id, player_id)
);

alter table draft_queue enable row level security;
alter table draft_prefs enable row level security;

-- §7.2: one live-draft pick, atomically. Returns false (never raises) when a check fails.
create or replace function draft_make_pick(
  p_round_id uuid, p_pick_number integer, p_player_id uuid, p_team_key text,
  p_require_due boolean, p_auto boolean
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  r      rounds%rowtype;
  n      integer;
  total  integer;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found then return false; end if;
  if r.draft_mode <> 'live' or r.draft_started_at is null or r.draft_paused_at is not null then
    return false;
  end if;
  total := r.roster_size * coalesce(cardinality(r.draft_order), 0);
  select count(*) into n from picks where round_id = p_round_id;
  if n >= total or n <> p_pick_number then return false; end if;
  if p_require_due and (r.pick_deadline is null or now() < r.pick_deadline) then return false; end if;
  begin
    insert into picks (round_id, pick_number, player_id, team_key, auto)
    values (p_round_id, p_pick_number, p_player_id, p_team_key, p_auto);
  exception when unique_violation then
    return false;  -- the team was taken (picks_round_team_key) or the slot is filled
  end;
  update rounds
     set pick_deadline = case
           when r.pick_seconds is null or n + 1 >= total then null
           else now() + make_interval(secs => r.pick_seconds)
         end
   where id = p_round_id;
  return true;
end;
$$;

-- §7.2: live-mode undo of the last pick, atomically, with the deadline restarted.
create or replace function draft_undo_pick(p_round_id uuid, p_pick_number integer) returns boolean
language plpgsql
set search_path = public
as $$
declare
  r  rounds%rowtype;
  n  integer;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found then return false; end if;
  select count(*) into n from picks where round_id = p_round_id;
  if n = 0 or p_pick_number <> n - 1 then return false; end if;
  delete from picks where round_id = p_round_id and pick_number = p_pick_number;
  update rounds
     set pick_deadline = case
           when r.pick_seconds is null or r.draft_started_at is null or r.draft_paused_at is not null then null
           else now() + make_interval(secs => r.pick_seconds)
         end
   where id = p_round_id;
  return true;
end;
$$;

-- Start / pause / resume with the database clock under the same row lock (plan deviation 1; spec §7.1).
create or replace function draft_control(p_round_id uuid, p_action text) returns boolean
language plpgsql
set search_path = public
as $$
declare
  r  rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found then return false; end if;
  if p_action = 'start' then
    if r.draft_mode <> 'live' or r.draft_started_at is not null then return false; end if;
    update rounds
       set draft_started_at = now(), draft_paused_at = null, paused_remaining_ms = null,
           pick_deadline = case when r.pick_seconds is null then null
                                else now() + make_interval(secs => r.pick_seconds) end
     where id = p_round_id;
  elsif p_action = 'pause' then
    if r.draft_started_at is null or r.draft_paused_at is not null then return false; end if;
    update rounds
       set draft_paused_at = now(),
           paused_remaining_ms = case when r.pick_deadline is null then null
             else greatest(0, floor(extract(epoch from (r.pick_deadline - now())) * 1000))::integer end,
           pick_deadline = null
     where id = p_round_id;
  elsif p_action = 'resume' then
    if r.draft_paused_at is null then return false; end if;
    update rounds
       set draft_paused_at = null,
           pick_deadline = case
             when r.pick_seconds is null then null
             when r.paused_remaining_ms is null then now() + make_interval(secs => r.pick_seconds)
             else now() + make_interval(secs => greatest(r.paused_remaining_ms, 10000) / 1000.0)
           end
     where id = p_round_id;
  else
    return false;
  end if;
  return true;
end;
$$;

-- For scripts/smoke-v2.ts (§8.1): every public table must have RLS on.
create or replace function public_tables_without_rls() returns setof text
language sql
stable
set search_path = public
as $$
  select c.relname::text
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
$$;

revoke execute on function draft_make_pick(uuid, integer, uuid, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function draft_undo_pick(uuid, integer) from public, anon, authenticated;
revoke execute on function draft_control(uuid, text) from public, anon, authenticated;
revoke execute on function public_tables_without_rls() from public, anon, authenticated;
grant execute on function draft_make_pick(uuid, integer, uuid, text, boolean, boolean) to service_role;
grant execute on function draft_undo_pick(uuid, integer) to service_role;
grant execute on function draft_control(uuid, text) to service_role;
grant execute on function public_tables_without_rls() to service_role;
