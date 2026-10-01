'use client';

import { useEffect, useState } from 'react';
import { adminFetch, ApiError, type AdminApi } from '@/lib/admin/client';

export type AdminSession =
  | { status: 'checking' }
  | { status: 'signed_out' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; api: AdminApi };

/** Asks the server whether the signed-in user is a commissioner of this league (spec §4.5). */
export function useAdmin(slug: string): AdminSession {
  const [session, setSession] = useState<AdminSession>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    adminFetch<{ ok: true }>(slug, '/verify')
      .then(() => {
        if (cancelled) return;
        const api: AdminApi = (path, init) => adminFetch(slug, path, init);
        setSession({ status: 'ready', api });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) setSession({ status: 'signed_out' });
        else if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setSession({ status: 'forbidden' });
        else setSession({ status: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return session;
}
