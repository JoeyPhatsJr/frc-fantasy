import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0005_formats.sql'), 'utf8');

describe('0005_formats.sql', () => {
  it('turns RLS on for every table it creates', () => {
    const created = [...sql.matchAll(/create table (?:if not exists )?(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(['manual_results', 'league_follows', 'league_skipped_events']);
    for (const table of created) {
      expect(sql, table).toMatch(new RegExp(`alter table ${table}\\s+enable row level security`));
    }
    expect(sql).not.toMatch(/create policy/i);
  });

  it('drops the v1 roster check safely before widening it to 15', () => {
    expect(sql).toContain('drop constraint if exists rounds_roster_size_check');
    expect(sql).toContain('check (roster_size between 1 and 15)');
  });

  it('only adds NOT NULL columns that have defaults', () => {
    for (const m of sql.matchAll(/add column (?:if not exists )?(\w+)\s+([^,;]+)/g)) {
      if (/not null/.test(m[2])) expect(m[2], m[1]).toMatch(/default/);
    }
  });

  // Controller ruling (like 0004): a partial paste in the SQL Editor can be re-run as a whole.
  it('is safe to re-run: columns and tables only if missing, named constraints dropped before re-adding', () => {
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    const added = [...sql.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
    expect(added).toEqual(['rounds_kind_event_key', 'rounds_kind_season', 'rounds_roster_size_check']);
    for (const name of added) {
      const drop = sql.indexOf(`drop constraint if exists ${name}`);
      expect(drop, name).toBeGreaterThanOrEqual(0);
      expect(drop, name).toBeLessThan(sql.indexOf(`add constraint ${name}`));
    }
  });

  it('allows one season round per league per season year (final review C1)', () => {
    expect(sql).toMatch(
      /create unique index if not exists rounds_league_season_year\s+on rounds \(league_id, season_year\) where kind = 'season'/,
    );
  });
});
