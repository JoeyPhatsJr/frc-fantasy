// Spec §9.2: Next.js caching is off. Every route and league page must export dynamic = 'force-dynamic',
// and anything that can call TBA must also raise maxDuration to 30 s (the TBA timeout is 5 s per call).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getRepo: () => ({}) }));
vi.mock('@/lib/tba/client', () => ({ getTba: vi.fn() }));

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
const all = walk(join(ROOT, 'app')).map(rel);
const routes = all.filter((f) => f.endsWith('/route.ts'));
const pages = all.filter((f) => f.startsWith('app/l/') && f.endsWith('/page.tsx'));

// Anything that reaches TBA, directly or through the loaders and views that call it. SP2 adds the
// follow sync (one /event/{key} look-up per new event) and league format setup (season dates).
const TBA_USERS =
  /\b(getTba|loadPool|loadEventData|getEventScores|loadRoundPage|loadLeaguePage|roundDetail|buildRoundView|syncFollowedEvents|scheduleFollowSync|setUpLeagueFormat|createSeasonRound|fetchSeasonDates)\b/;

const modules = [...routes, ...pages];

describe('§9.2 dynamic exports', () => {
  it('finds the routes and pages it is meant to check', () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  describe.each(modules)('%s', (file) => {
    it("exports dynamic = 'force-dynamic'", async () => {
      const mod = await import(/* @vite-ignore */ join(ROOT, file));
      expect(mod.dynamic).toBe('force-dynamic');
    });

    const source = readFileSync(join(ROOT, file), 'utf8');
    if (TBA_USERS.test(source)) {
      it('exports maxDuration = 30 because it can call TBA', async () => {
        const mod = await import(/* @vite-ignore */ join(ROOT, file));
        expect(mod.maxDuration).toBe(30);
      });
    }
  });
});
