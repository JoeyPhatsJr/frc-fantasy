import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { POST as join } from '@/app/api/invites/[code]/join/route';
import { GET as preview } from '@/app/api/invites/[code]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { makeUser, setUser } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo, { signIn: false }));
  setUser(null);
});

const code = () => params({ code: league.inviteCode.toLowerCase() }); // codes match case-insensitively

describe('GET /api/invites/{code}', () => {
  it('previews the league for anyone', async () => {
    const res = await preview(request('GET', '/x'), code());
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      slug: league.slug, name: 'Habich Fam', commissioner: 'Commish', memberCount: 1, full: false, alreadyMember: false,
    });
  });
  it('answers the same 404 for junk and for unknown codes', async () => {
    const a = await preview(request('GET', '/x'), params({ code: 'nope!' }));
    const b = await preview(request('GET', '/x'), params({ code: 'ZZZZZZ' }));
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await readJson(a)).toEqual(await readJson(b));
  });
});

describe('POST /api/invites/{code}/join (spec §4.3)', () => {
  it('answers 401 signed out', async () => {
    expect((await join(request('POST', '/x'), code())).status).toBe(401);
  });

  it('joins with the profile name', async () => {
    const mom = await makeUser(repo, 'Mom');
    setUser(mom);
    const res = await join(request('POST', '/x'), code());
    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ slug: league.slug });
    expect(await repo.getMemberByUser(league.id, mom.id)).toMatchObject({ name: 'Mom', role: 'player' });
  });

  it('suffixes a colliding name: Mom, Mom 2', async () => {
    setUser(await makeUser(repo, 'Mom'));
    await join(request('POST', '/x'), code());
    const second = await makeUser(repo, 'mom');
    setUser(second);
    await join(request('POST', '/x'), code());
    expect((await repo.getMemberByUser(league.id, second.id))!.name).toBe('mom 2');
  });

  it('is a no-op for someone already in the league', async () => {
    const mom = await makeUser(repo, 'Mom');
    setUser(mom);
    await join(request('POST', '/x'), code());
    const again = await join(request('POST', '/x'), code());
    expect(again.status).toBe(200);
    expect(await readJson(again)).toEqual({ slug: league.slug, alreadyMember: true });
    expect(await repo.listPlayers(league.id)).toHaveLength(2);
  });

  it('refuses the 31st player, counting unlinked rows', async () => {
    for (let i = 0; i < 29; i++) await repo.createPlayer(league.id, `Old ${i}`); // + Commish = 30
    setUser(await makeUser(repo, 'Late'));
    const res = await join(request('POST', '/x'), code());
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('League is full');
    const p = await readJson(await preview(request('GET', '/x'), code()));
    expect(p.full).toBe(true);
  });

  it('answers 404 for an unknown code', async () => {
    setUser(await makeUser(repo, 'Mom'));
    expect((await join(request('POST', '/x'), params({ code: 'ZZZZZZ' }))).status).toBe(404);
  });
});
