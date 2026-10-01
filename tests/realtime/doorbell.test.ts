import { describe, expect, it, vi } from 'vitest';
import { draftTopic, ring } from '@/lib/realtime/doorbell';

describe('ring (§7.5)', () => {
  it('posts one empty "changed" message to the round topic with the service key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 202 }));
    await ring('r1', { fetchImpl, url: 'https://abc.supabase.co/', key: 'service-key' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abc.supabase.co/realtime/v1/api/broadcast');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('apikey')).toBe('service-key');
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ topic: 'draft:r1', event: 'changed', payload: {} }],
    });
    expect(draftTopic('r1')).toBe('draft:r1');
  });
  it('never throws: network errors and bad statuses are logged and ignored', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      ring('r1', { fetchImpl: vi.fn(async () => { throw new Error('offline'); }), url: 'https://x', key: 'k' }),
    ).resolves.toBeUndefined();
    await expect(
      ring('r1', { fetchImpl: vi.fn(async () => new Response('no', { status: 500 })), url: 'https://x', key: 'k' }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
  it('skips the call when Supabase settings are missing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn();
    await ring('r1', { fetchImpl, url: undefined, key: 'k' });
    expect(fetchImpl).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
