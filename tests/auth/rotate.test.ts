import { beforeEach, describe, expect, it } from 'vitest';
import { verifyToken } from '@/lib/auth/commissioner';
import { adminLink, rotateAdminToken } from '@/lib/auth/rotate';
import type { Repo } from '@/lib/db/repo';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
});

describe('rotateAdminToken', () => {
  it('replaces the token: the new one works and the old one stops working', async () => {
    const { league, token: oldToken } = await seedLeague(repo);
    const out = await rotateAdminToken(repo, league.slug);
    expect(out).toMatchObject({ slug: league.slug, name: 'Habich Fam' });
    expect(out.token).not.toBe(oldToken);

    const saved = (await repo.getLeagueBySlug(league.slug))!;
    expect(verifyToken(out.token, saved.adminTokenHash)).toBe(true);
    expect(verifyToken(oldToken, saved.adminTokenHash)).toBe(false);
  });

  it('changes nothing else about the league', async () => {
    const { league } = await seedLeague(repo);
    await rotateAdminToken(repo, league.slug);
    const saved = (await repo.getLeagueBySlug(league.slug))!;
    expect(saved).toMatchObject({ id: league.id, name: league.name, defaultScoring: league.defaultScoring });
  });

  it('throws for an unknown league', async () => {
    await expect(rotateAdminToken(repo, 'no-such-league')).rejects.toThrow(/no league/i);
  });
});

describe('adminLink', () => {
  it('puts the token in the URL fragment', () => {
    expect(adminLink('https://frc-fantasy.vercel.app', 'habich-fam-abc234', 'TOKEN')).toBe(
      'https://frc-fantasy.vercel.app/l/habich-fam-abc234/admin#k=TOKEN',
    );
  });
  it('tolerates a trailing slash on the site URL', () => {
    expect(adminLink('http://localhost:3000/', 's', 't')).toBe('http://localhost:3000/l/s/admin#k=t');
  });
});
