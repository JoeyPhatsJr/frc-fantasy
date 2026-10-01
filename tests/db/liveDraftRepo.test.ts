import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

async function setup(now = new Date('2026-10-23T23:00:00.000Z')) {
  const clock = { now };
  const repo = createMemoryRepo({ now: () => clock.now });
  const { league, commissioner } = await seedLeague(repo);
  const round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { repo, clock, league, commissioner, round };
}

describe('live draft columns', () => {
  it('new rounds start in commissioner mode with no timer and no draft state', async () => {
    const { round } = await setup();
    expect(round).toMatchObject({
      draftMode: 'commissioner', pickSeconds: null, draftStartedAt: null,
      draftPausedAt: null, pausedRemainingMs: null, pickDeadline: null,
    });
  });

  it('updateRound stores draftMode, pickSeconds and pausedRemainingMs', async () => {
    const { repo, round } = await setup();
    const saved = await repo.updateRound(round.id, { draftMode: 'live', pickSeconds: 60, pausedRemainingMs: null });
    expect(saved).toMatchObject({ draftMode: 'live', pickSeconds: 60, pausedRemainingMs: null });
    expect((await repo.updateRound(round.id, { pickSeconds: null })).pickSeconds).toBeNull();
  });

  it('insertPick records auto = false unless told otherwise', async () => {
    const { repo, round, commissioner } = await setup();
    await repo.updateRound(round.id, { draftOrder: [commissioner.id] });
    const pick = await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: commissioner.id, teamKey: 'frc1' });
    expect(pick.auto).toBe(false);
  });
});

async function liveSetup(opts: { pickSeconds?: 30 | 60 | 90 | 120 | null } = {}) {
  const s = await setup();
  const mom = await s.repo.createMember({ leagueId: s.league.id, userId: randomUUID(), name: 'Mom', role: 'player' });
  const round = await s.repo.updateRound(s.round.id, {
    draftOrder: [s.commissioner.id, mom.id], rosterSize: 2, draftMode: 'live',
    pickSeconds: opts.pickSeconds === undefined ? 60 : opts.pickSeconds,
  });
  const at = (seconds: number) => new Date(s.clock.now.getTime() + seconds * 1000);
  const pick = (pickNumber: number, teamKey: string, extra: { requireDue?: boolean; auto?: boolean; playerId?: string } = {}) =>
    s.repo.makePickAtomic({
      roundId: round.id, pickNumber, teamKey,
      playerId: extra.playerId ?? s.commissioner.id,
      requireDue: extra.requireDue ?? false, auto: extra.auto ?? false,
    });
  const reload = async () => (await s.repo.getRound(round.id))!;
  return { ...s, mom, round, at, pick, reload };
}

describe('draftControl start (§7.1)', () => {
  it('starts a live round once, setting the first deadline from the database clock', async () => {
    const t = await liveSetup();
    expect(await t.repo.draftControl(t.round.id, 'start')).toBe(true);
    const r = await t.reload();
    expect(r.draftStartedAt).toBe(t.clock.now.toISOString());
    expect(r.pickDeadline).toBe(t.at(60).toISOString());
    expect(await t.repo.draftControl(t.round.id, 'start')).toBe(false);
  });
  it('refuses to start a commissioner-mode round', async () => {
    const t = await liveSetup();
    await t.repo.updateRound(t.round.id, { draftMode: 'commissioner' });
    expect(await t.repo.draftControl(t.round.id, 'start')).toBe(false);
  });
  it('with the timer off, there is no deadline', async () => {
    const t = await liveSetup({ pickSeconds: null });
    await t.repo.draftControl(t.round.id, 'start');
    expect((await t.reload()).pickDeadline).toBeNull();
  });
});

describe('makePickAtomic (§7.2)', () => {
  it('refuses before the draft starts and while paused', async () => {
    const t = await liveSetup();
    expect(await t.pick(0, 'frc1')).toBe(false);
    await t.repo.draftControl(t.round.id, 'start');
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.pick(0, 'frc1')).toBe(false);
  });
  it('saves the pick, records auto, and moves the deadline', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(5);
    expect(await t.pick(0, 'frc1', { auto: true })).toBe(true);
    const [saved] = await t.repo.listPicks(t.round.id);
    expect(saved).toMatchObject({ pickNumber: 0, teamKey: 'frc1', auto: true });
    expect((await t.reload()).pickDeadline).toBe(t.at(60).toISOString());
  });
  it('refuses a stale pick number and a taken team without throwing', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    expect(await t.pick(0, 'frc2')).toBe(false); // stale
    expect(await t.pick(1, 'frc1', { playerId: t.mom.id })).toBe(false); // taken
    expect(await t.repo.listPicks(t.round.id)).toHaveLength(1);
  });
  it('two phones picking the same slot at once: exactly one wins (Review Focus 1)', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    const results = await Promise.all([t.pick(0, 'frc1'), t.pick(0, 'frc2'), t.pick(0, 'frc1')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await t.repo.listPicks(t.round.id)).toHaveLength(1);
  });
  it('requireDue waits for the database deadline', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(29);
    expect(await t.pick(0, 'frc1', { requireDue: true })).toBe(false);
    t.clock.now = t.at(1);
    expect(await t.pick(0, 'frc1', { requireDue: true })).toBe(true);
  });
  it('requireDue never fires with the timer off', async () => {
    const t = await liveSetup({ pickSeconds: null });
    await t.repo.draftControl(t.round.id, 'start');
    expect(await t.pick(0, 'frc1', { requireDue: true })).toBe(false);
  });
  it('clears the deadline after the last pick and refuses more', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    for (const [n, team] of [[0, 'frc1'], [1, 'frc2'], [2, 'frc3'], [3, 'frc4']] as const) {
      expect(await t.pick(n, team)).toBe(true);
    }
    expect((await t.reload()).pickDeadline).toBeNull();
    expect(await t.pick(4, 'frc5')).toBe(false);
  });
});

describe('undoPickAtomic (§7.2)', () => {
  it('removes only the last pick and restarts the deadline', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    await t.pick(1, 'frc2');
    t.clock.now = t.at(20);
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(false);
    expect(await t.repo.undoPickAtomic(t.round.id, 1)).toBe(true);
    expect((await t.repo.listPicks(t.round.id)).map((p) => p.teamKey)).toEqual(['frc1']);
    expect((await t.reload()).pickDeadline).toBe(t.at(60).toISOString());
  });
  it('undo while paused leaves the deadline empty', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(true);
    expect((await t.reload()).pickDeadline).toBeNull();
  });
});

describe('pause / resume (§7.1)', () => {
  it('keeps the time left and gives it back on resume', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(18);
    expect(await t.repo.draftControl(t.round.id, 'pause')).toBe(true);
    expect(await t.reload()).toMatchObject({ pausedRemainingMs: 42_000, pickDeadline: null });
    t.clock.now = t.at(300);
    expect(await t.repo.draftControl(t.round.id, 'resume')).toBe(true);
    expect(await t.reload()).toMatchObject({ draftPausedAt: null, pickDeadline: t.at(42).toISOString() });
  });
  it('paused after the clock ran out: resume gives 10 s (Review Focus 3)', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(45);
    await t.repo.draftControl(t.round.id, 'pause');
    expect((await t.reload()).pausedRemainingMs).toBe(0);
    await t.repo.draftControl(t.round.id, 'resume');
    expect((await t.reload()).pickDeadline).toBe(t.at(10).toISOString());
  });
  it('a cleared remaining time (timer changed while paused) resumes with the full new timer', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    await t.repo.draftControl(t.round.id, 'pause');
    await t.repo.updateRound(t.round.id, { pickSeconds: 90, pausedRemainingMs: null });
    await t.repo.draftControl(t.round.id, 'resume');
    expect((await t.reload()).pickDeadline).toBe(t.at(90).toISOString());
  });
  it('refuses to pause twice or resume a running draft', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    expect(await t.repo.draftControl(t.round.id, 'resume')).toBe(false);
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.repo.draftControl(t.round.id, 'pause')).toBe(false);
  });
});

describe('queue and auto-draft', () => {
  it('replaces and returns the queue in order', async () => {
    const t = await liveSetup();
    expect(await t.repo.getQueue(t.round.id, t.mom.id)).toEqual([]);
    await t.repo.setQueue(t.round.id, t.mom.id, ['frc3', 'frc1']);
    await t.repo.setQueue(t.round.id, t.mom.id, ['frc2', 'frc3']);
    expect(await t.repo.getQueue(t.round.id, t.mom.id)).toEqual(['frc2', 'frc3']);
    expect(await t.repo.getQueue(t.round.id, t.commissioner.id)).toEqual([]);
  });
  it('stores auto-draft per player', async () => {
    const t = await liveSetup();
    expect(await t.repo.getAutodraft(t.round.id, t.mom.id)).toBe(false);
    await t.repo.setAutodraft(t.round.id, t.mom.id, true);
    expect(await t.repo.getAutodraft(t.round.id, t.mom.id)).toBe(true);
    expect(await t.repo.listAutodraftPlayers(t.round.id)).toEqual([t.mom.id]);
    await t.repo.setAutodraft(t.round.id, t.mom.id, false);
    expect(await t.repo.listAutodraftPlayers(t.round.id)).toEqual([]);
  });
});

// Beyond the brief: cases where 0003 (as corrected in d07b604) differs from the brief's sketch,
// plus the SQL's return-false-never-raise paths. The memory repo must match the SQL exactly.
describe('memory repo matches 0003 SQL', () => {
  it('undo while paused with a timer: the undone player gets a full timer on resume (d07b604)', async () => {
    const t = await liveSetup({ pickSeconds: 60 });
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    t.clock.now = t.at(50);
    await t.repo.draftControl(t.round.id, 'pause');
    expect((await t.reload()).pausedRemainingMs).toBe(10_000);
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(true);
    expect(await t.reload()).toMatchObject({ pausedRemainingMs: 60_000, pickDeadline: null });
    t.clock.now = t.at(500);
    await t.repo.draftControl(t.round.id, 'resume');
    expect((await t.reload()).pickDeadline).toBe(t.at(60).toISOString());
  });
  it('undo while paused with the timer off leaves the remaining time alone', async () => {
    const t = await liveSetup({ pickSeconds: null });
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(true);
    expect(await t.reload()).toMatchObject({ pausedRemainingMs: null, pickDeadline: null });
  });
  it('undo while running keeps the saved remaining time as it was', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    await t.repo.draftControl(t.round.id, 'pause');
    t.clock.now = t.at(5);
    await t.repo.draftControl(t.round.id, 'resume');
    const before = (await t.reload()).pausedRemainingMs;
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(true);
    expect((await t.reload()).pausedRemainingMs).toBe(before);
  });
  it('undo before the draft starts never sets a deadline', async () => {
    const t = await liveSetup();
    await t.repo.insertPick({ roundId: t.round.id, pickNumber: 0, playerId: t.commissioner.id, teamKey: 'frc1' });
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(true);
    expect((await t.reload()).pickDeadline).toBeNull();
  });
  it('undo with no picks returns false', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(false);
    expect(await t.repo.undoPickAtomic(t.round.id, -1)).toBe(false);
  });
  it('resuming a finished draft clears the pause but sets no deadline (d07b604)', async () => {
    const t = await liveSetup({ pickSeconds: 60 });
    await t.repo.draftControl(t.round.id, 'start');
    for (const [n, team] of [[0, 'frc1'], [1, 'frc2'], [2, 'frc3'], [3, 'frc4']] as const) await t.pick(n, team);
    expect(await t.repo.draftControl(t.round.id, 'pause')).toBe(true);
    expect((await t.reload()).pausedRemainingMs).toBeNull();
    expect(await t.repo.draftControl(t.round.id, 'resume')).toBe(true);
    expect(await t.reload()).toMatchObject({ draftPausedAt: null, pickDeadline: null });
  });
  it('resume with the timer off sets no deadline', async () => {
    const t = await liveSetup({ pickSeconds: null });
    await t.repo.draftControl(t.round.id, 'start');
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.repo.draftControl(t.round.id, 'resume')).toBe(true);
    expect((await t.reload()).pickDeadline).toBeNull();
  });
  it('pause before start is refused; a pause records the database time', async () => {
    const t = await liveSetup();
    expect(await t.repo.draftControl(t.round.id, 'pause')).toBe(false);
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(7);
    await t.repo.draftControl(t.round.id, 'pause');
    expect((await t.reload()).draftPausedAt).toBe(t.clock.now.toISOString());
  });
  it('a filled pick slot (gap in pick numbers) returns false instead of throwing', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    await t.repo.insertPick({ roundId: t.round.id, pickNumber: 1, playerId: t.mom.id, teamKey: 'frc9' });
    expect(await t.pick(1, 'frc1')).toBe(false);
    expect(await t.repo.listPicks(t.round.id)).toHaveLength(1);
  });
  it('a round with no draft order has no picks to make', async () => {
    const t = await liveSetup();
    await t.repo.updateRound(t.round.id, { draftOrder: [] });
    await t.repo.draftControl(t.round.id, 'start');
    expect(await t.pick(0, 'frc1')).toBe(false);
  });
  it('an unknown round or action returns false instead of throwing', async () => {
    const t = await liveSetup();
    const missing = randomUUID();
    expect(await t.repo.draftControl(missing, 'start')).toBe(false);
    expect(await t.repo.undoPickAtomic(missing, 0)).toBe(false);
    expect(
      await t.repo.makePickAtomic({
        roundId: missing, pickNumber: 0, playerId: t.commissioner.id, teamKey: 'frc1', requireDue: false, auto: false,
      }),
    ).toBe(false);
    expect(await t.repo.draftControl(t.round.id, 'stop' as 'start')).toBe(false);
    expect((await t.reload()).draftStartedAt).toBeNull();
  });
  it('requireDue fires exactly at the deadline (now() >= pick_deadline)', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(30);
    expect(await t.pick(0, 'frc1', { requireDue: true, auto: true })).toBe(true);
  });
  it('queue and auto-draft go away with their round or player (on delete cascade)', async () => {
    const t = await liveSetup();
    await t.repo.setQueue(t.round.id, t.mom.id, ['frc1']);
    await t.repo.setAutodraft(t.round.id, t.mom.id, true);
    await t.repo.setQueue(t.round.id, t.commissioner.id, ['frc2']);
    await t.repo.setAutodraft(t.round.id, t.commissioner.id, true);
    await t.repo.deletePlayer(t.mom.id);
    expect(await t.repo.getQueue(t.round.id, t.mom.id)).toEqual([]);
    expect(await t.repo.listAutodraftPlayers(t.round.id)).toEqual([t.commissioner.id]);
    await t.repo.deleteRound(t.round.id);
    expect(await t.repo.getQueue(t.round.id, t.commissioner.id)).toEqual([]);
    expect(await t.repo.listAutodraftPlayers(t.round.id)).toEqual([]);
  });
  it('the queue returned is a copy', async () => {
    const t = await liveSetup();
    const keys = ['frc1', 'frc2'];
    await t.repo.setQueue(t.round.id, t.mom.id, keys);
    keys.push('frc3');
    (await t.repo.getQueue(t.round.id, t.mom.id)).push('frc4');
    expect(await t.repo.getQueue(t.round.id, t.mom.id)).toEqual(['frc1', 'frc2']);
  });
  it('rlsDisabledTables is empty in memory', async () => {
    const t = await liveSetup();
    expect(await t.repo.rlsDisabledTables()).toEqual([]);
  });
});
