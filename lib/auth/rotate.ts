import { generateAdminToken, hashToken } from '@/lib/auth/commissioner';
import type { Repo } from '@/lib/db/repo';

export function adminLink(origin: string, slug: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/l/${slug}/admin#k=${token}`;
}

/** Issues a new admin token for a league. The old admin link stops working immediately. */
export async function rotateAdminToken(
  repo: Repo,
  slug: string,
): Promise<{ slug: string; name: string; token: string }> {
  const league = await repo.getLeagueBySlug(slug);
  if (!league) throw new Error(`No league with the slug "${slug}"`);
  const token = generateAdminToken();
  await repo.updateLeague(league.id, { adminTokenHash: hashToken(token) });
  return { slug: league.slug, name: league.name, token };
}
