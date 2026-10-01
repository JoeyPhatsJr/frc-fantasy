import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { seasonDates } from '@/lib/season/calendar';
import { getTba } from '@/lib/tba/client';
import type { EventSimple } from '@/lib/tba/types';

export async function fetchSeasonDates(year: number): Promise<{ startDate: string; endDate: string; stale: boolean }> {
  const res = await getTba<EventSimple[]>(`/events/${year}/simple`, { windowMs: DEFAULT_WINDOW_MS });
  return { ...seasonDates(Array.isArray(res.data) ? res.data : null, year), stale: res.stale };
}
