// Spec §7.5: after every live-draft change the server "rings" an empty broadcast. Phones that hear it
// refetch the draft state. The message carries no data, so a public channel leaks nothing.

export const DOORBELL_EVENT = 'changed';

export function draftTopic(roundId: string): string {
  return `draft:${roundId}`;
}

export type RingDeps = { fetchImpl: typeof fetch; url: string | undefined; key: string | undefined };

/** Never throws: polling on the phones covers a missed ring. */
export async function ring(roundId: string, deps: Partial<RingDeps> = {}): Promise<void> {
  const url = 'url' in deps ? deps.url : process.env.SUPABASE_URL;
  const key = 'key' in deps ? deps.key : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('doorbell: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return;
  }
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      cache: 'no-store',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: draftTopic(roundId), event: DOORBELL_EVENT, payload: {} }] }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) console.error(`doorbell: broadcast answered ${res.status}`);
  } catch (err) {
    console.error('doorbell: broadcast failed', err);
  }
}
