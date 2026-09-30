// Runs in the browser. Do not import anything from node:* or lib/db here.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type AdminApi = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

async function send<T>(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> },
  fetchImpl: typeof fetch,
): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON. Handled below.
  }
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Something went wrong (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export function createLeague(
  input: { name: string; visibility?: 'link' | 'members' },
  fetchImpl: typeof fetch = fetch,
): Promise<{ slug: string; inviteCode: string }> {
  return send('/api/leagues', { method: 'POST', body: input }, fetchImpl);
}

/** Calls /api/l/{slug}/admin/*. The browser sends the Supabase session cookie; there is no token any more. */
export function adminFetch<T>(
  slug: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  return send<T>(`/api/l/${encodeURIComponent(slug)}/admin${path}`, init, fetchImpl);
}
