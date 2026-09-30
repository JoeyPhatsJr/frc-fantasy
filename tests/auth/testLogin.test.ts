import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as testLogin } from '@/app/api/test/login/route';
import { testLoginAllowed } from '@/lib/auth/testLogin';

const req = (auth?: string) =>
  new Request('http://localhost/api/test/login', {
    method: 'POST',
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.com' }),
  });

afterEach(() => vi.unstubAllEnvs());

describe('testLoginAllowed (spec §8.1)', () => {
  const secret = 's'.repeat(32);
  it('needs the secret, the matching bearer, and no VERCEL', () => {
    expect(testLoginAllowed(req(`Bearer ${secret}`), { E2E_AUTH_SECRET: secret })).toBe(true);
    expect(testLoginAllowed(req(`Bearer ${secret}`), { E2E_AUTH_SECRET: secret, VERCEL: '1' })).toBe(false);
    expect(testLoginAllowed(req(`Bearer ${secret}`), {})).toBe(false);
    expect(testLoginAllowed(req(`Bearer ${secret}`), { E2E_AUTH_SECRET: '' })).toBe(false);
    expect(testLoginAllowed(req('Bearer wrong'), { E2E_AUTH_SECRET: secret })).toBe(false);
    expect(testLoginAllowed(req(), { E2E_AUTH_SECRET: secret })).toBe(false);
  });
});

describe('POST /api/test/login', () => {
  it('is a plain 404 when not allowed (no secret configured)', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', '');
    const res = await testLogin(req('Bearer x'));
    expect(res.status).toBe(404);
  });
  it('is a 404 on Vercel even with the right secret', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', 'k'.repeat(32));
    vi.stubEnv('VERCEL', '1');
    expect((await testLogin(req(`Bearer ${'k'.repeat(32)}`))).status).toBe(404);
  });
  it('is a 404 with a wrong bearer even when a secret is configured', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', 'k'.repeat(32));
    vi.stubEnv('VERCEL', '');
    expect((await testLogin(req('Bearer wrong'))).status).toBe(404);
  });
  it('is a 404 with no Authorization header even when a secret is configured', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', 'k'.repeat(32));
    vi.stubEnv('VERCEL', '');
    expect((await testLogin(req())).status).toBe(404);
  });
});
