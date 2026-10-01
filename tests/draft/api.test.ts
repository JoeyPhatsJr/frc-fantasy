import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftApiError, draftApi } from '@/lib/draft/api';

afterEach(() => vi.unstubAllGlobals());

describe('draftApi', () => {
  it('posts a pick to the player route with JSON', async () => {
    const fetchMock = vi.fn(async () => Response.json({ pick: {} }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await draftApi('habich-fam', 'r1').pick(3, 'frc341');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/l/habich-fam/rounds/r1/draft/pick');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ expectedPickNumber: 3, teamKey: 'frc341' });
  });

  it('turns an error body into DraftApiError with its code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'That team was just taken', code: 'taken' }, { status: 409 })));
    const err = await draftApi('s', 'r').pick(0, 'frc1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftApiError);
    expect(err).toMatchObject({ status: 409, code: 'taken', message: 'That team was just taken' });
  });

  it('uses the admin routes for commissioner actions and handles 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await draftApi('s', 'r').undo(4);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/l/s/admin/rounds/r/picks/4');
  });
});
