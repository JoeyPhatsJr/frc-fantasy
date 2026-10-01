import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: null as null | { id: string; user_metadata: unknown },
  getUserError: null as null | { message: string },
  ensure: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user }, error: h.getUserError }),
      signOut: h.signOut,
    },
  }),
}));
vi.mock('@/lib/auth/profile', () => ({ ensureProfile: (...a: unknown[]) => h.ensure(...a) }));
vi.mock('@/lib/db', () => ({ getRepo: () => ({}) }));

import { POST } from '@/app/auth/finish/route';

const post = (body: unknown) =>
  POST(new Request('http://test.local/auth/finish', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));

beforeEach(() => {
  h.user = { id: 'u1', user_metadata: { full_name: 'Mom' } };
  h.getUserError = null;
  h.ensure.mockReset().mockResolvedValue({ id: 'u1' });
  h.signOut.mockClear();
});

describe('POST /auth/finish', () => {
  it('creates the profile and returns a safe redirect', async () => {
    const res = await post({ next: '/join/ABC234' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/join/ABC234' });
    expect(h.ensure).toHaveBeenCalledWith({}, h.user);
  });
  it('never redirects off-site', async () => {
    const res = await post({ next: '//evil.com' });
    expect(await res.json()).toEqual({ redirectTo: '/' });
  });
  it('401 when there is no session', async () => {
    h.user = null;
    const res = await post({});
    expect(res.status).toBe(401);
    expect(h.ensure).not.toHaveBeenCalled();
  });
  it('signs out and answers 500 when the profile cannot be created', async () => {
    h.ensure.mockRejectedValue(new Error('db down'));
    const res = await post({ next: '/' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Sign-in didn't finish — try again." });
    expect(h.signOut).toHaveBeenCalled();
  });
  it('tolerates a missing or non-JSON body', async () => {
    const res = await POST(new Request('http://test.local/auth/finish', { method: 'POST', body: 'x' }));
    expect(await res.json()).toEqual({ redirectTo: '/' });
  });
});
