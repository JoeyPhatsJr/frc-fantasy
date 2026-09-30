'use client';

import { useEffect, useState } from 'react';
import { adminFetch, ApiError, storageKey, tokenFromHash, type AdminApi } from '@/lib/admin/client';

export type AdminSession =
  | { status: 'checking' }
  | { status: 'invalid' }
  | { status: 'error'; message: string }
  | { status: 'ready'; api: AdminApi };

function readStored(slug: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(slug));
  } catch {
    return null; // private browsing can block localStorage
  }
}

function store(slug: string, token: string | null) {
  try {
    if (token === null) window.localStorage.removeItem(storageKey(slug));
    else window.localStorage.setItem(storageKey(slug), token);
  } catch {
    // Without storage the admin link still works; it just has to be opened with its #k= part each time.
  }
  window.dispatchEvent(new Event('frcf:admin')); // tells the TabBar to show or hide the Admin tab now
}

/**
 * Commissioner sign-in (spec §4):
 * 1. read the token from the URL fragment, 2. remember it on this device,
 * 3. remove it from the address bar, 4. check it with the server.
 */
export function useAdmin(slug: string): AdminSession {
  const [session, setSession] = useState<AdminSession>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;

    const fromLink = tokenFromHash(window.location.hash);
    if (fromLink) store(slug, fromLink);
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const token = fromLink ?? readStored(slug);
    if (!token) {
      setSession({ status: 'invalid' });
      return;
    }

    adminFetch<{ ok: true }>(slug, token, '/verify')
      .then(() => {
        if (cancelled) return;
        const api: AdminApi = (path, init) => adminFetch(slug, token, path, init);
        setSession({ status: 'ready', api });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          store(slug, null); // a rotated or mistyped token is useless; forget it
          setSession({ status: 'invalid' });
        } else {
          setSession({ status: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return session;
}
