'use client';

import { useEffect, useState } from 'react';
import { storageKey, tokenFromHash } from '@/lib/admin/client';

function hasAdminToken(slug: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(slug)) !== null;
  } catch {
    return false; // private browsing can block localStorage
  }
}

/**
 * "Commissioner" next to the league name, on the device that holds the commissioner link.
 * The league bar is server-rendered and can't read localStorage, so this renders nothing until
 * mounted (no hydration mismatch). Same check as the TabBar's Admin tab: a stored token, or a
 * `#k=` token still in the address bar on the first visit. `useAdmin` fires 'frcf:admin' when it
 * stores or forgets the token, so a rejected link hides the label right away.
 */
export function CommissionerTag({ slug }: { slug: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const check = () => setShow(hasAdminToken(slug) || tokenFromHash(window.location.hash) !== null);
    check();
    window.addEventListener('frcf:admin', check);
    return () => window.removeEventListener('frcf:admin', check);
  }, [slug]);

  if (!show) return null;
  return <span className="shrink-0 text-[15px] font-semibold leading-[22px] text-secondary">Commissioner</span>;
}
