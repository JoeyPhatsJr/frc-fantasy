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

export function storageKey(slug: string): string {
  return `frcf:admin:${slug}`;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

/** Reads the commissioner token from a URL fragment like "#k=abc". */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('k');
  return token && TOKEN_RE.test(token) ? token : null;
}

export function adminLinkFor(origin: string, slug: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/l/${slug}/admin#k=${token}`;
}

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
  name: string,
  passcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ slug: string; adminToken: string }> {
  return send('/api/leagues', { method: 'POST', body: { name, passcode } }, fetchImpl);
}

export function adminFetch<T>(
  slug: string,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  return send<T>(
    `/api/l/${encodeURIComponent(slug)}/admin${path}`,
    { ...init, headers: { 'x-commissioner-key': token } },
    fetchImpl,
  );
}
