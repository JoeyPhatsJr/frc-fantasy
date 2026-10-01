import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0004_team_stats.sql'), 'utf8');

describe('migration 0004_team_stats.sql', () => {
  it('adds body_hash to tba_cache', () => {
    expect(sql).toMatch(/alter table tba_cache\s+add column if not exists body_hash text/);
  });

  it.each(['event_scores', 'team_stats'])('creates %s with RLS on and no policies', (table) => {
    expect(sql).toMatch(new RegExp(`create table if not exists ${table} \\(`));
    expect(sql).toMatch(new RegExp(`alter table ${table}\\s+enable row level security`));
    expect(sql).not.toMatch(/create policy/i);
  });

  // Final review M9: a partial paste in the SQL Editor can be re-run as a whole.
  it('is safe to re-run: every column, table, and index is created only if missing', () => {
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).toMatch(/create index if not exists team_stats_season_idx on team_stats \(season\)/);
  });

  it('keys event_scores by (event_key, config_hash) and team_stats by (team_key, season)', () => {
    expect(sql).toMatch(/primary key \(event_key, config_hash\)/);
    expect(sql).toMatch(/primary key \(team_key, season\)/);
  });

  it('has every column the repo reads', () => {
    for (const col of [
      'source_stamp', 'scores', 'info', 'computed_at',
      'events_played', 'total_points', 'qual_wins', 'qual_losses', 'qual_ties', 'best_finish',
      'awards', 'events', 'latest_event_key', 'latest_opr', 'latest_rank', 'updated_at',
    ]) {
      expect(sql, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});
