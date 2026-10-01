import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { DELETE as undoRoute, PATCH as replaceRoute } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route';
import { POST as adminPick } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

const clock = { now: T0 };
beforeEach(() => {
  clock.now = T0;
  resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
});
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const pickFor = (s: Seeded, expectedPickNumber: number, teamKey: string) =>
  adminPick(request('POST', '/x', { body: { expectedPickNumber, teamKey } }), params({ slug: s.league.slug, id: s.round.id }));
const undo = (s: Seeded, n: number) =>
  undoRoute(request('DELETE', '/x'), params({ slug: s.league.slug, id: s.round.id, pickNumber: String(n) }));
const replace = (s: Seeded, n: number, teamKey: string) =>
  replaceRoute(request('PATCH', '/x', { body: { teamKey } }), params({ slug: s.league.slug, id: s.round.id, pickNumber: String(n) }));

describe('commissioner picks in a live draft', () => {
  it('"Pick for Mom" saves Mom\'s pick through the atomic function and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await pickFor(s, 0, 'frc1')).status).toBe(201); // Joey's own
    const res = await pickFor(s, 1, 'frc2');
    expect(res.status).toBe(201);
    expect((await readJson(res)).pick).toEqual({ pickNumber: 1, playerId: s.mom.id, teamKey: 'frc2' });
    expect(mocks.ring).toHaveBeenCalledTimes(2);
  });

  it('uses the live-draft 409 codes', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc1');
    expect((await readJson(await pickFor(s, 1, 'frc1'))).code).toBe('taken');
    expect((await readJson(await pickFor(s, 0, 'frc3'))).code).toBe('stale');
    await mocks.repo.draftControl(s.round.id, 'pause');
    expect((await readJson(await pickFor(s, 1, 'frc3'))).code).toBe('not_live');
  });
});

describe('commissioner undo in a live draft', () => {
  it('undoing an auto-pick removes it for good: auto-draft goes off, the deadline restarts (Review Focus 5)', async () => {
    const s = await seedLiveDraft(mocks.repo, { pickSeconds: 60 });
    await mocks.repo.setAutodraft(s.round.id, s.joey.id, true);
    await mocks.repo.draftControl(s.round.id, 'start');
    // Simulate the start route's advance: Joey (auto) picks frc1.
    await mocks.repo.makePickAtomic({ roundId: s.round.id, pickNumber: 0, playerId: s.joey.id, teamKey: 'frc1', requireDue: false, auto: true });
    mocks.user = s.joeyUser;
    clock.now = later(20);
    const res = await undo(s, 0);
    expect(res.status).toBe(204);
    expect(await mocks.repo.listPicks(s.round.id)).toEqual([]);
    expect(await mocks.repo.getAutodraft(s.round.id, s.joey.id)).toBe(false);
    expect((await mocks.repo.getRound(s.round.id))!.pickDeadline).toBe(later(80).toISOString());
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('undoing a hand pick leaves auto-draft alone (so an auto-drafter is picked for again)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc5'); // by hand
    await mocks.repo.setAutodraft(s.round.id, s.joey.id, true); // Joey turns auto-draft on afterwards
    expect((await undo(s, 0)).status).toBe(204);
    expect(await mocks.repo.getAutodraft(s.round.id, s.joey.id)).toBe(true);
    // Joey is back on the clock with auto-draft on, so advance picks for him (lowest number).
    expect((await mocks.repo.listPicks(s.round.id)).map((p) => [p.teamKey, p.auto])).toEqual([['frc1', true]]);
  });

  it('only the last pick', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc1');
    await pickFor(s, 1, 'frc2');
    expect((await undo(s, 0)).status).toBe(409);
  });

  it('replacing a pick in a live draft rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc1');
    mocks.ring.mockClear();
    expect((await replace(s, 0, 'frc4')).status).toBe(200);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });
});
