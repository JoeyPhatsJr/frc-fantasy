import type { Repo } from '@/lib/db/repo';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';

let repo: Repo | null = null;

/** The one database handle for the server. Tests replace this module with an in-memory repo. */
export function getRepo(): Repo {
  if (!repo) repo = createSupabaseRepo(createSupabaseClient());
  return repo;
}
