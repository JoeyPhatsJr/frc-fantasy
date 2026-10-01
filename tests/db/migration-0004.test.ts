import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0004_team_stats.sql'), 'utf8');

describe('migration 0004_team_stats.sql', () => {
  it('adds body_hash to tba_cache', () => {
    expect(sql).toMatch(/alter table tba_cache\s+add column body_hash text/);
  });

  it.each(['event_scores', 'team_stats'])('creates %s with RLS on and no policies', (table) => {
    expect(sql).toMatch(new RegExp(`create table ${table} \\(`));
    expect(sql).toMatch(new RegExp(`alter table ${table}\\s+enable row level security`));
    expect(sql).not.toMatch(/create policy/i);
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
