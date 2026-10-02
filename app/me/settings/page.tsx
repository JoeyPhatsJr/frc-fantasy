import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Settings moved to /you (UX overhaul); keep old links and bookmarks working. */
export default function SettingsRedirect() {
  redirect('/you');
}
