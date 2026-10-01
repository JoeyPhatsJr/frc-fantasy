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
  it('quals done, eliminated, no schedule', () => {
    expect(nextMatchLabel('frc1', [played(1, ['frc1'], ['frc2']), upcoming(2, ['frc3'], ['frc4'])])).toBe('Quals done');
    const elim = [played(1, ['frc1'], ['frc2']), match({ level: 'sf', set: 1, num: 1, red: ['frc3'], blue: ['frc4'] })];
    expect(nextMatchLabel('frc1', elim)).toBe('Eliminated'); // not on a playoff alliance
    expect(nextMatchLabel('frc1', [])).toBe('Schedule not posted');
    expect(nextMatchLabel('frc1', null)).toBe('Schedule not posted');
  });

  // Between quals and playoffs, and between double-elimination rounds, a team with nothing scheduled
  // is not necessarily done or out (final review, Minor #1).
  const de = (set: number, red: string[], blue: string[], winner?: 'red' | 'blue') =>
    match({
      level: 'sf', set, num: 1, red, blue,
      ...(winner ? { redScore: winner === 'red' ? 10 : 5, blueScore: winner === 'blue' ? 10 : 5 } : {}),
    });
  const final = (num: number, red: string[], blue: string[], winner?: 'red' | 'blue') =>
    match({
      level: 'f', set: 1, num, red, blue,
      ...(winner ? { redScore: winner === 'red' ? 10 : 5, blueScore: winner === 'blue' ? 10 : 5 } : {}),
    });

  it('all quals played and no bracket posted yet: waiting for playoffs, not "Done"', () => {
    expect(nextMatchLabel('frc1', [played(1, ['frc1'], ['frc2']), played(2, ['frc3'], ['frc4'])])).toBe('Waiting for playoffs');
  });

  it('won a double-elimination match, next one not posted: waiting, not "Eliminated"', () => {
    const ms = [played(1, ['frc1'], ['frc2']), de(1, ['frc1'], ['frc2'], 'red'), de(2, ['frc3'], ['frc4'])];
    expect(nextMatchLabel('frc1', ms)).toBe('Waiting for next match');
  });

  it('one double-elimination loss is not out yet', () => {
    const ms = [played(1, ['frc1'], ['frc2']), de(1, ['frc1'], ['frc2'], 'blue'), de(2, ['frc3'], ['frc4'])];
    expect(nextMatchLabel('frc1', ms)).toBe('Waiting for next match');
  });

  it('two playoff losses at the same level is eliminated', () => {
    const ms = [
      played(1, ['frc1'], ['frc2']),
      de(1, ['frc1'], ['frc2'], 'blue'),
      de(5, ['frc3'], ['frc1'], 'red'),
      de(9, ['frc5'], ['frc6']),
    ];
    expect(nextMatchLabel('frc1', ms)).toBe('Eliminated');
  });

  it('a bracket loss plus one finals loss is not out while the finals go on', () => {
    const ms = [de(1, ['frc1'], ['frc2'], 'blue'), final(1, ['frc1'], ['frc2'], 'blue'), final(2, ['frc1'], ['frc2'])];
    expect(nextMatchLabel('frc1', ms)).toBe('F2 · up next');
    expect(nextMatchLabel('frc1', ms.slice(0, 2).concat(final(2, ['frc9'], ['frc8'])))).toBe('Waiting for next match');
  });

  it('every match played, playoffs included: Done', () => {
    expect(nextMatchLabel('frc1', [played(1, ['frc1'], ['frc2']), de(1, ['frc1'], ['frc2'], 'red')])).toBe('Done');
    expect(nextMatchLabel('frc9', [played(1, ['frc1'], ['frc2']), de(1, ['frc1'], ['frc2'], 'red')])).toBe('Done');
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

  it("one event's schedule failing to load only degrades that team's row", async () => {
    await repo.createProfile({ id: 'u1', displayName: 'Joey', avatarUrl: null });
    const lg = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    const me = await repo.createMember({ leagueId: lg.id, userId: 'u1', name: 'Joey', role: 'commissioner' });
    for (const [eventKey, teamKey] of [['2026aaa', 'frc1'], ['2026bbb', 'frc2']]) {
      const r = await repo.createRound({
        leagueId: lg.id, eventKey, eventName: `Event ${eventKey}`, startDate: '2026-10-01', endDate: '2026-10-01',
        timezone: 'America/New_York', scoring: defaultScoring(),
      });
      await repo.updateRound(r.id, { draftOrder: [me.id], rosterSize: 1 });
      await repo.insertPick({ roundId: r.id, pickNumber: 0, playerId: me.id, teamKey });
    }
    let bbbScheduleCalls = 0;
    h.getTba.mockImplementation(async (path: string) => {
      if (path === '/event/2026aaa/matches/simple') {
        return { data: [match({ num: 1, red: ['frc1'], blue: ['frc9'] })], fetchedAt: null, stale: false };
      }
      // The league page's load works; the Me loop's own schedule read fails (e.g. tba_cache unreachable).
      if (path === '/event/2026bbb/matches/simple' && ++bbbScheduleCalls > 1) throw new Error('tba_cache down');
      return { data: null, fetchedAt: null, stale: false };
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const page = await loadMePage('u1', new Date('2026-10-01T16:00:00Z'));
    expect(page.leagues.map((l) => l.error)).toEqual([false]);
    expect(page.teams).toEqual([
      { teamKey: 'frc1', leagueName: 'Fam', eventName: 'Event 2026aaa', label: 'Q1 · up next', status: 'live' },
      { teamKey: 'frc2', leagueName: 'Fam', eventName: 'Event 2026bbb', label: 'Schedule not posted', status: 'live' },
    ]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('a live manual round (no TBA event) asks TBA for nothing and shows no schedule', async () => {
    await repo.createProfile({ id: 'u1', displayName: 'Joey', avatarUrl: null });
    const lg = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    const me = await repo.createMember({ leagueId: lg.id, userId: 'u1', name: 'Joey', role: 'commissioner' });
    const r = await repo.createRound({
      leagueId: lg.id, eventKey: null, kind: 'manual', eventName: 'Garage Games', startDate: '2026-10-01',
      endDate: '2026-10-01', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.updateRound(r.id, { draftOrder: [me.id], rosterSize: 1 });
    await repo.insertPick({ roundId: r.id, pickNumber: 0, playerId: me.id, teamKey: 'frc1' });

    const page = await loadMePage('u1', new Date('2026-10-01T16:00:00Z'));
    expect(page.teams).toEqual([
      { teamKey: 'frc1', leagueName: 'Fam', eventName: 'Garage Games', label: 'Schedule not posted', status: 'live' },
    ]);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
