import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown, signOut: vi.fn(async () => ({})) }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth: { signOut: h.signOut } }) }));

import { DELETE as deleteMe } from '@/app/api/me/route';
import { PATCH as patchProfile } from '@/app/api/me/profile/route';
import type { Repo } from '@/lib/db/repo';
import { makeUser, setUser } from '../helpers/auth';
import { readJson, request } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';
import { defaultScoring } from '@/lib/scoring/config';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.signOut.mockClear();
  setUser(null);
});

describe('PATCH /api/me/profile', () => {
  it('updates display name and FRC team; null clears the team', async () => {
    const me = await makeUser(repo, 'Joey');
    setUser(me);
    const res = await patchProfile(request('PATCH', '/x', { body: { displayName: ' Joey H ', frcTeam: 5181 } }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).profile).toMatchObject({ displayName: 'Joey H', frcTeam: 5181 });
    const cleared = await patchProfile(request('PATCH', '/x', { body: { frcTeam: null } }));
    expect((await readJson(cleared)).profile.frcTeam).toBeNull();
  });
  it('validates', async () => {
    setUser(await makeUser(repo, 'Joey'));
    for (const body of [{}, { displayName: '' }, { frcTeam: 0 }, { frcTeam: 100000 }, { frcTeam: 1.5 }]) {
      expect((await patchProfile(request('PATCH', '/x', { body }))).status, JSON.stringify(body)).toBe(400);
    }
  });
  it('answers 401 signed out', async () => {
    expect((await patchProfile(request('PATCH', '/x', { body: { frcTeam: 1 } }))).status).toBe(401);
  });
});

describe('DELETE /api/me', () => {
  it('deletes the account, clears the session cookie, and answers 204', async () => {
    const me = await makeUser(repo, 'Joey');
    setUser(me);
    expect((await deleteMe(request('DELETE', '/x'))).status).toBe(204);
    expect(await repo.getProfile(me.id)).toBeNull();
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });
  it('answers 409 and changes nothing while blocked (no sign-out)', async () => {
    const me = await makeUser(repo, 'Joey');
    const mom = await makeUser(repo, 'Mom');
    setUser(me);
    const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring(), createdBy: me.id });
    await repo.createMember({ leagueId: league.id, userId: me.id, name: 'Joey', role: 'commissioner' });
    await repo.createMember({ leagueId: league.id, userId: mom.id, name: 'Mom', role: 'player' });
    expect((await deleteMe(request('DELETE', '/x'))).status).toBe(409);
    expect(await repo.getProfile(me.id)).not.toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });
  it('answers 401 signed out', async () => {
    expect((await deleteMe(request('DELETE', '/x'))).status).toBe(401);
  });
});
