import { describe, expect, it, vi } from 'vitest';
import { adminFetch, ApiError, createLeague } from '@/lib/admin/client';

function respond(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('adminFetch', () => {
  it('sends JSON body, and no-store to the right URL', async () => {
    const fetchImpl = respond(200, { ok: true });
    const out = await adminFetch('fam-abc234', '/players', { method: 'POST', body: { name: 'Mom' } }, fetchImpl);
    expect(out).toEqual({ ok: true });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/l/fam-abc234/admin/players');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe('{"name":"Mom"}');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('sends no commissioner header; the session cookie does the work', async () => {
    const fetchImpl = respond(200, { ok: true });
    await adminFetch('fam-abc234', '/state', {}, fetchImpl);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/l/fam-abc234/admin/state');
    expect(new Headers(init.headers).get('x-commissioner-key')).toBeNull();
    expect(init.credentials).toBe('same-origin');
  });

  it('defaults to GET with no body', async () => {
    const fetchImpl = respond(200, {});
    await adminFetch('fam-abc234', '/state', {}, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    expect(await adminFetch('s', '/x', { method: 'DELETE' }, respond(204))).toBeUndefined();
  });

  it('throws ApiError with the server message', async () => {
    const attempt = adminFetch('s', '/x', {}, respond(409, { error: 'That team was just taken' }));
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 409, message: 'That team was just taken' });
  });

  it('throws ApiError with a fallback message when the body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(adminFetch('s', '/x', {}, fetchImpl)).rejects.toMatchObject({
      status: 502,
      message: 'Something went wrong (502)',
    });
  });

  it('throws ApiError with status 0 when the network fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(adminFetch('s', '/x', {}, fetchImpl)).rejects.toMatchObject({
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
