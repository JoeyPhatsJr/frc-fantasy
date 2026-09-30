import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown, getTba: vi.fn() }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...a: unknown[]) => h.getTba(...a) }));

import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { loadMePage, matchLabel, nextMatchLabel, seasonSummary } from '@/lib/views/me';
import { match } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('matchLabel', () => {
  it('names quals, double-elim matches and finals like TBA', () => {
    expect(matchLabel(match({ num: 14, red: [], blue: [] }))).toBe('Q14');
    expect(matchLabel(match({ level: 'sf', set: 5, num: 1, red: [], blue: [] }))).toBe('M5');
    expect(matchLabel(match({ level: 'f', set: 1, num: 2, red: [], blue: [] }))).toBe('F2');
    expect(matchLabel(match({ level: 'qf', set: 3, num: 2, red: [], blue: [] }))).toBe('QF3-2');
  });
});

describe('nextMatchLabel (spec §4.6 Live now)', () => {
  const played = (num: number, red: string[], blue: string[]) => match({ num, red, blue, redScore: 10, blueScore: 5 });
  const upcoming = (num: number, red: string[], blue: string[]) => match({ num, red, blue });
  it('up next / in N matches', () => {
    const ms = [played(1, ['frc1'], ['frc2']), upcoming(2, ['frc3'], ['frc4']), upcoming(3, ['frc5'], ['frc341'])];
    expect(nextMatchLabel('frc3', ms)).toBe('Q2 · up next');
    expect(nextMatchLabel('frc341', ms)).toBe('Q3 · in 1 match');
    ms.push(upcoming(4, ['frc6'], ['frc7']), upcoming(5, ['frc8'], ['frc2']));
    expect(nextMatchLabel('frc2', ms)).toBe('Q5 · in 3 matches');
  });
  it('quals done, eliminated, done, no schedule', () => {
    expect(nextMatchLabel('frc1', [played(1, ['frc1'], ['frc2']), upcoming(2, ['frc3'], ['frc4'])])).toBe('Quals done');
    const elim = [played(1, ['frc1'], ['frc2']), match({ level: 'sf', set: 1, num: 1, red: ['frc3'], blue: ['frc4'] })];
    expect(nextMatchLabel('frc1', elim)).toBe('Eliminated');
    expect(nextMatchLabel('frc1', [played(1, ['frc1'], ['frc2'])])).toBe('Done');
    expect(nextMatchLabel('frc1', [])).toBe('Schedule not posted');
    expect(nextMatchLabel('frc1', null)).toBe('Schedule not posted');
  });
});

describe('seasonSummary (spec §4.6 My season)', () => {
  it('totals this year, finds the best pick, averages finished rounds only', () => {
    const out = seasonSummary(
      [
        { eventName: 'Ramp Riot', startDate: '2026-10-24', finalized: true, me: { total: 120, rank: 2, teams: [{ teamKey: 'frc341', total: 62 }, { teamKey: 'frc5181', total: 58 }] } },
        { eventName: 'Brunswick Eruption', startDate: '2026-11-07', finalized: true, me: { total: 80, rank: 1, teams: [{ teamKey: 'frc1', total: 40 }] } },
        { eventName: 'Next Up', startDate: '2026-12-05', finalized: false, me: { total: 10, rank: 4, teams: [] } },
        { eventName: 'Last Year', startDate: '2025-10-25', finalized: true, me: { total: 999, rank: 1, teams: [{ teamKey: 'frc9', total: 500 }] } },
        { eventName: 'Not in it', startDate: '2026-10-01', finalized: true, me: null },
      ],
      '2026',
    );
    expect(out).toEqual({ total: 210, bestPick: { teamKey: 'frc341', eventName: 'Ramp Riot', points: 62 }, averageFinish: 1.5 });
  });
  it('is empty-safe', () => {
    expect(seasonSummary([], '2026')).toEqual({ total: 0, bestPick: null, averageFinish: null });
  });
});

describe('loadMePage', () => {
  let repo: Repo;
  beforeEach(() => {
    repo = createMemoryRepo();
    h.repo = repo;
    h.getTba.mockResolvedValue({ data: null, fetchedAt: null, stale: false });
  });

  it('lists my leagues with rank and total, and marks one that fails to load', async () => {
    await repo.createProfile({ id: 'u1', displayName: 'Joey', avatarUrl: null });
    const good = await repo.createLeague({ slug: 'good-abc234', name: 'Good', defaultScoring: defaultScoring() });
    const bad = await repo.createLeague({ slug: 'bad-abc234', name: 'Bad', defaultScoring: defaultScoring() });
    await repo.createMember({ leagueId: good.id, userId: 'u1', name: 'Joey', role: 'commissioner' });
    await repo.createMember({ leagueId: bad.id, userId: 'u1', name: 'Joey', role: 'player' });
    const real = repo.listRounds.bind(repo);
    vi.spyOn(repo, 'listRounds').mockImplementation(async (id) => {
      if (id === bad.id) throw new Error('boom');
      return real(id);
    });

    const page = await loadMePage('u1', new Date('2026-10-01T12:00:00Z'));
    expect(page.leagues).toEqual([
      { slug: 'good-abc234', name: 'Good', isCommissioner: true, rank: 1, total: 0, anyLive: false, error: false },
      { slug: 'bad-abc234', name: 'Bad', isCommissioner: false, rank: null, total: 0, anyLive: false, error: true },
    ]);
    expect(page.teams).toEqual([]);
  });
});
