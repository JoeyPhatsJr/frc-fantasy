import type { Repo } from '@/lib/db/repo';
import type { ProfileRow } from '@/lib/db/types';
import { NAME_MAX } from '@/lib/leagues/names';

type Meta = Record<string, unknown>;
const asMeta = (m: unknown): Meta => (typeof m === 'object' && m !== null ? (m as Meta) : {});

/** Spec §4.2: full_name → name → user_name, trimmed, cut to 40 chars; fallback "Player". */
export function displayNameFromMetadata(meta: unknown): string {
  const m = asMeta(meta);
  for (const key of ['full_name', 'name', 'user_name']) {
    const v = m[key];
    if (typeof v !== 'string') continue;
    const name = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX).trim();
    if (name) return name;
  }
  return 'Player';
}

export function avatarFromMetadata(meta: unknown): string | null {
  const m = asMeta(meta);
  for (const key of ['avatar_url', 'picture']) {
    const v = m[key];
    if (typeof v === 'string' && v.startsWith('https://') && v.length <= 2000) return v;
  }
  return null;
}

/** Called after every successful sign-in; only the first one creates the row. */
export function ensureProfile(repo: Repo, user: { id: string; user_metadata?: unknown }): Promise<ProfileRow> {
  return repo.createProfile({
    id: user.id,
    displayName: displayNameFromMetadata(user.user_metadata),
    avatarUrl: avatarFromMetadata(user.user_metadata),
  });
}
