import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

function seedRound(eventKey = '2025parr'): Promise<RoundRow> {
  return repo.createRound({
    leagueId: league.id,
    eventKey,
    eventName: eventKey,
    startDate: '2026-10-24',
    endDate: '2026-10-24',
    timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  ({ league } = await seedLeague(repo));
});

describe('auto-finalize data (spec 2026-10-02 §3)', () => {
  it('new rounds default to autoFinalize true', async () => {
    expect((await seedRound()).autoFinalize).toBe(true);
  });

  it('updateRound can turn autoFinalize off and back on', async () => {
    const round = await seedRound();
    expect((await repo.updateRound(round.id, { autoFinalize: false })).autoFinalize).toBe(false);
    expect((await repo.updateRound(round.id, { autoFinalize: true })).autoFinalize).toBe(true);
  });

  it('lists only unfinalized rounds with auto-finalize on', async () => {
    const open = await seedRound('2025parr');
    const final = await seedRound('2025pahat');
    const reopened = await seedRound('2025pawas');
    await repo.updateRound(final.id, { finalizedAt: '2025-10-30T10:00:00.000Z' });
    await repo.updateRound(reopened.id, { autoFinalize: false });
    expect((await repo.listAutoFinalizeCandidates()).map((r) => r.id)).toEqual([open.id]);
  });
});

describe('0006_auto_finalize.sql', () => {
  const sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0006_auto_finalize.sql'), 'utf8');

  it('adds auto_finalize, defaulting on, and is safe to re-run', () => {
    expect(sql).toMatch(/alter table rounds\s+add column if not exists auto_finalize boolean not null default true;/);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
  });
});
