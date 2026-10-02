-- 0006_auto_finalize.sql — rounds finalize on their own after the event (spec 2026-10-02 §3).
-- Additive and safe to re-run. Reopening a round sets auto_finalize = false for that round.
alter table rounds
  add column if not exists auto_finalize boolean not null default true;
