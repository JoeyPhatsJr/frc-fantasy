import { describe, expect, it, vi } from 'vitest';
import {
  adminFetch,
  adminLinkFor,
  ApiError,
  createLeague,
  storageKey,
  tokenFromHash,
} from '@/lib/admin/client';

const TOKEN = 'A'.repeat(43);

function respond(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('storageKey', () => {
  it('matches the spec (§4)', () => {
    expect(storageKey('habich-fam-k3x9qd')).toBe('frcf:admin:habich-fam-k3x9qd');
  });
});

describe('tokenFromHash', () => {
  it('reads the token from #k=...', () => {
    expect(tokenFromHash(`#k=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`k=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#other=1&k=${TOKEN}`)).toBe(TOKEN);
  });
  it('returns null when there is no usable token', () => {
    for (const hash of ['', '#', '#k=', '#k=short', '#token=abc', `#k=${'A'.repeat(300)}`, '#k=has spaces in it!!!!!!!!!!!!']) {
      expect(tokenFromHash(hash), hash).toBeNull();
    }
  });
});

describe('adminLinkFor', () => {
  it('puts the token in the fragment', () => {
    expect(adminLinkFor('https://x.test', 'fam-abc234', TOKEN)).toBe(`https://x.test/l/fam-abc234/admin#k=${TOKEN}`);
  });
});

describe('adminFetch', () => {
  it('sends the token header, JSON body, and no-store to the right URL', async () => {
    const fetchImpl = respond(200, { ok: true });
    const out = await adminFetch('fam-abc234', TOKEN, '/players', { method: 'POST', body: { name: 'Mom' } }, fetchImpl);
    expect(out).toEqual({ ok: true });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/l/fam-abc234/admin/players');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe('{"name":"Mom"}');
    const headers = new Headers(init.headers);
    expect(headers.get('x-commissioner-key')).toBe(TOKEN);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('defaults to GET with no body', async () => {
    const fetchImpl = respond(200, {});
    await adminFetch('fam-abc234', TOKEN, '/state', {}, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    expect(await adminFetch('s', TOKEN, '/x', { method: 'DELETE' }, respond(204))).toBeUndefined();
  });

  it('throws ApiError with the server message', async () => {
    const attempt = adminFetch('s', TOKEN, '/x', {}, respond(409, { error: 'That team was just taken' }));
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 409, message: 'That team was just taken' });
  });

  it('throws ApiError with a fallback message when the body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(adminFetch('s', TOKEN, '/x', {}, fetchImpl)).rejects.toMatchObject({
      status: 502,
      message: 'Something went wrong (502)',
    });
  });

  it('throws ApiError with status 0 when the network fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(adminFetch('s', TOKEN, '/x', {}, fetchImpl)).rejects.toMatchObject({
      status: 0,
      message: "Couldn't reach the server. Check your connection.",
    });
  });
});

describe('createLeague', () => {
  it('posts the name and visibility and returns slug + invite code', async () => {
    const fetchImpl = respond(201, { slug: 'fam-abc234', inviteCode: 'ABC234' });
    const out = await createLeague({ name: 'Fam', visibility: 'members' }, fetchImpl);
    expect(out).toEqual({ slug: 'fam-abc234', inviteCode: 'ABC234' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/leagues');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Fam', visibility: 'members' });
  });
  it('surfaces the server message (e.g. the 5-league cap)', async () => {
    const attempt = createLeague({ name: 'Fam' }, respond(409, { error: "You've reached the 5-league limit" }));
    await expect(attempt).rejects.toMatchObject({ status: 409, message: "You've reached the 5-league limit" });
  });
});
