import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  exchange: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { exchangeCodeForSession: h.exchange } }),
}));

import { GET as callback } from '@/app/auth/callback/route';
import type { Repo } from '@/lib/db/repo';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.exchange.mockReset();
  h.exchange.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { full_name: 'Joey' } } }, error: null });
});

const call = (qs: string) => callback(new Request(`https://frc.example/auth/callback${qs}`));

describe('GET /auth/callback (spec §4.1)', () => {
  it('exchanges the code, creates the profile, and goes to next', async () => {
    const res = await call('?code=abc&next=%2Fjoin%2FABC234');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://frc.example/join/ABC234');
    expect(h.exchange).toHaveBeenCalledWith('abc');
    expect((await repo.getProfile('u1'))!.displayName).toBe('Joey');
  });
  it('never redirects off-site', async () => {
    for (const next of ['%2F%2Fevil.com', 'https%3A%2F%2Fevil.com', '%2F%5Cevil.com']) {
      const res = await call(`?code=abc&next=${next}`);
      expect(res.headers.get('location'), next).toBe('https://frc.example/');
    }
  });
  it('sends provider errors, missing codes and failed exchanges to /?auth_error=1', async () => {
    expect((await call('?error=access_denied')).headers.get('location')).toBe('https://frc.example/?auth_error=1');
    expect((await call('')).headers.get('location')).toBe('https://frc.example/?auth_error=1');
    h.exchange.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad code' } });
    expect((await call('?code=bad')).headers.get('location')).toBe('https://frc.example/?auth_error=1');
    expect(await repo.getProfile('u1')).toBeNull();
  });
});
