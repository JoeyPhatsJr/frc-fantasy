import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ claims: undefined as unknown, error: null as unknown, throws: false }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getClaims: async () => {
      if (h.throws) throw new SyntaxError('Unexpected token in JSON');
      return { data: h.claims === undefined ? null : { claims: h.claims }, error: h.error };
    } },
  }),
}));

import { getUser, requireUser } from '@/lib/auth/session';

describe('getUser', () => {
  it('returns the signed-in user from the verified claims', async () => {
    h.claims = { sub: 'u-1', email: 'joey@example.com' };
    h.error = null;
    expect(await getUser()).toEqual({ id: 'u-1', email: 'joey@example.com' });
  });
  it('is null with no session, a bad token, or no subject', async () => {
    for (const [claims, error] of [
      [undefined, null],
      [{ sub: 'u-1' }, { message: 'invalid JWT' }],
      [{ email: 'x@example.com' }, null],
    ] as const) {
      h.claims = claims;
      h.error = error;
      expect(await getUser()).toBeNull();
    }
  });
  it('is null (not a 500) when getClaims throws on a garbage cookie', async () => {
    h.throws = true;
    try {
      expect(await getUser()).toBeNull();
    } finally {
      h.throws = false;
    }
  });
  it('treats a missing email as null', async () => {
    h.claims = { sub: 'u-2' };
    h.error = null;
    expect(await getUser()).toEqual({ id: 'u-2', email: null });
  });
});

describe('requireUser', () => {
  it('answers 401 when signed out', async () => {
    h.claims = undefined;
    await expect(requireUser()).rejects.toMatchObject({ status: 401, message: 'Sign in first' });
  });
});
