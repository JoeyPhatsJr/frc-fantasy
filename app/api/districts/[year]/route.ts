import { handle, HttpError, json } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { getTba } from '@/lib/tba/client';
import type { DistrictSimple } from '@/lib/tba/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ year: string }> };

/** Districts for the season pool picker (spec §5.5). Signed-in only: it's for creating/editing leagues. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { year } = await ctx.params;
    const y = Number(year);
    if (!/^\d{4}$/.test(year) || y < 1992 || y > 2100) throw new HttpError(404, 'Not found');
    await requireUser();
    const res = await getTba<DistrictSimple[]>(`/districts/${y}`, { windowMs: 24 * 60 * 60_000 });
    const districts = (Array.isArray(res.data) ? res.data : [])
      .filter((d) => d && typeof d.key === 'string')
      .map((d) => ({ key: d.key, name: d.display_name || (d.abbreviation ?? d.key).toUpperCase() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json({ districts });
  });
}
