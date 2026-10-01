// Runs in the browser. Do not import anything from node:* or lib/db here (types only).
import type { DraftAction } from '@/lib/db/repo';
import type { DraftState } from '@/lib/draft/state';
import type { PoolEntry } from '@/lib/pool/entries';

export class DraftApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'DraftApiError';
  }
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new DraftApiError(res.status, data.error ?? 'Something went wrong', data.code);
  return data as T;
}

export type DraftApi = ReturnType<typeof draftApi>;

export function draftApi(slug: string, roundId: string) {
  const base = `/api/l/${slug}/rounds/${roundId}`;
  const admin = `/api/l/${slug}/admin/rounds/${roundId}`;
  return {
    state: () => call<DraftState>(`${base}/draft/state`),
    pool: () => call<PoolEntry[]>(`${base}/pool`),
    pick: (expectedPickNumber: number, teamKey: string) =>
      call<unknown>(`${base}/draft/pick`, 'POST', { expectedPickNumber, teamKey }),
    tick: (expectedPickNumber: number) => call<{ picked: boolean }>(`${base}/draft/tick`, 'POST', { expectedPickNumber }),
    setQueue: (teamKeys: string[]) => call<{ queue: string[] }>(`${base}/draft/queue`, 'PUT', { teamKeys }),
    setAutodraft: (on: boolean) => call<{ autodraft: boolean }>(`${base}/draft/autodraft`, 'PUT', { on }),
    pickFor: (expectedPickNumber: number, teamKey: string) =>
      call<unknown>(`${admin}/picks`, 'POST', { expectedPickNumber, teamKey }),
    undo: (pickNumber: number) => call<void>(`${admin}/picks/${pickNumber}`, 'DELETE'),
    control: (action: DraftAction) => call<DraftState>(`${admin}/draft/${action}`, 'POST'),
  };
}
