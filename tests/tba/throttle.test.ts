import { describe, expect, it } from 'vitest';
import { throttleFetch } from '@/lib/tba/throttle';

describe('throttleFetch', () => {
  it('spaces requests 1/perSecond apart, even when fired all at once', async () => {
    const t = 0;
    const sleeps: number[] = [];
    const clock = {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    };
    let calls = 0;
    const inner = (async () => {
      calls += 1;
      return new Response('[]');
    }) as typeof fetch;

    const f = throttleFetch(inner, 5, clock);
    await Promise.all([f('a'), f('b'), f('c')]);

    expect(calls).toBe(3);
    expect(sleeps).toEqual([200, 400]);
  });

  it('does not wait when requests are already far apart', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const f = throttleFetch((async () => new Response('[]')) as typeof fetch, 5, {
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await f('a');
    t = 1_000;
    await f('b');
    expect(sleeps).toEqual([]);
  });
});
