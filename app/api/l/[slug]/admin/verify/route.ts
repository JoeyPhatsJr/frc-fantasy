import { handle, json, requireCommissioner } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    await requireCommissioner(req, slug);
    return json({ ok: true });
  });
}
