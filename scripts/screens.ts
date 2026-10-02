// Full-page screenshots of every main screen, light and dark, for a visual check of the UX overhaul.
// Seeds two throwaway leagues on the real dev Supabase project (one with a finished Ramp Riot draft, one
// with a live draft where it's Joey's pick), shoots, then deletes them and their test users.
//
// The live room is shot first, while Joey's 2-minute pick clock is still running.
// Needs a production server on :3100 with the same E2E_AUTH_SECRET, e.g.
//   E2E_AUTH_SECRET=… npm run build && E2E_AUTH_SECRET=… npx next start -p 3100
//   E2E_AUTH_SECRET=… npx tsx scripts/screens.ts
// Saves {page}-{theme}.png (whole page) and {page}-{theme}-top.png (first screen) per page.
// Exits non-zero if any page scrolls sideways (document wider than the window).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { cleanup, seedDraft, seedFinishedDraft, signIn } from '../e2e/helpers';

try {
  process.loadEnvFile('.env.local');
} catch {
  // env vars passed in directly
}

const BASE_URL = process.env.SCREENS_BASE_URL ?? 'http://localhost:3100';
const OUT = path.join(process.cwd(), '.superpowers', 'sdd', '2026-10-01-ux-overhaul', 'screens');
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const overflows: string[] = [];

async function newContext(browser: Browser, theme: Theme, width: number): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('frcf:theme', t);
    } catch {
      // storage blocked: the page falls back to light
    }
  }, theme);
  return ctx;
}

/** Waits for client-loaded pages (admin, draft room) to finish their first fetch and for fonts. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => !/Loading…|Loading the draft…/.test(document.querySelector('main')?.textContent ?? document.body.textContent ?? ''),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => console.warn(`  still loading: ${page.url()}`));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function shoot(page: Page, route: string, name: string) {
  await page.goto(route);
  await settle(page);
  const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  if (wide.doc > wide.win) overflows.push(`${name}: ${route} is ${wide.doc}px wide in a ${wide.win}px window`);
  // The first screen, as a phone shows it on arrival.
  await page.screenshot({ path: path.join(OUT, `${name}-top.png`) });
  // The whole page. Growing the window to the page's height (rather than fullPage) keeps the fixed bottom bar
  // and live-draft pill at the bottom, where they sit once you scroll to the end, instead of mid-page.
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (size) await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  if (size) await page.setViewportSize(size);
  console.log(`  ${name}.png${wide.doc > wide.win ? '  <-- SIDEWAYS SCROLL' : ''}`);
}

async function main() {
  if (!process.env.E2E_AUTH_SECRET) throw new Error('Set E2E_AUTH_SECRET (the same one the server on :3100 has)');
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const run = Date.now().toString(36);

  // Sign in once to create the users; each theme's context signs in again (same users, new cookies).
  const boot = await browser.newContext({ baseURL: BASE_URL });
  const joeyEmail = `screens-joey-${run}@example.com`;
  const momEmail = `screens-mom-${run}@example.com`;
  const joeyId = await signIn(boot, joeyEmail, 'Joey');
  const momCtx = await browser.newContext({ baseURL: BASE_URL });
  const momId = await signIn(momCtx, momEmail, 'Mom');

  const scored = await seedFinishedDraft(joeyId, momId, 'Habich Family League');
  const live = await seedDraft(joeyId, momId, 'Ramp Riot Draft Night');
  try {
    // The live draft: a 2-minute timer, then Joey, Mom, Mom so Joey is on the clock with 3 picks on the board.
    await createSupabaseRepo(createSupabaseClient()).updateRound(live.roundId, { pickSeconds: 120 });
    const admin = `/api/l/${live.slug}/admin/rounds/${live.roundId}`;
    const api = `/api/l/${live.slug}/rounds/${live.roundId}`;
    const ok = async (res: { ok(): boolean; status(): number; text(): Promise<string> }, what: string) => {
      if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
    };
    await ok(await boot.request.post(`${admin}/draft/start`), 'start draft');
    const pool = (await (await boot.request.get(`${api}/pool`)).json()) as { teamKey: string; available: boolean }[];
    const teams = pool.filter((e) => e.available).map((e) => e.teamKey);
    await ok(await boot.request.post(`${api}/draft/pick`, { data: { expectedPickNumber: 0, teamKey: teams[0] } }), 'pick 0');
    await ok(await momCtx.request.post(`${api}/draft/pick`, { data: { expectedPickNumber: 1, teamKey: teams[1] } }), 'pick 1');
    await ok(await momCtx.request.post(`${api}/draft/pick`, { data: { expectedPickNumber: 2, teamKey: teams[2] } }), 'pick 2');

    const l = `/l/${scored.slug}`;
    const r = `${l}/r/${scored.roundId}`;
    const signedIn: [string, string][] = [
      ['home', '/'],
      ['leagues', '/leagues'],
      ['you', '/you'],
      ['leagues-new', '/leagues/new'],
      ['standings', l],
      ['event', r],
      ['draft-done', `${r}/draft`],
      ['admin', `${l}/admin`],
      ['admin-round', `/l/${scored.slug}/admin/r/${scored.roundId}`],
      ['admin-round-live', `/l/${live.slug}/admin/r/${live.roundId}`],
    ];
    const signedOut: [string, string][] = [
      ['signin', '/signin'],
      ['landing', '/'],
    ];

    // The live room first, while Joey's 2-minute clock is still running.
    const room = `/l/${live.slug}/r/${live.roundId}/draft`;
    for (const theme of THEMES) {
      for (const width of [390, 360]) {
        const ctx = await newContext(browser, theme, width);
        await signIn(ctx, joeyEmail, 'Joey');
        await shoot(await ctx.newPage(), room, `draft-live${width === 360 ? '-360' : ''}-${theme}`);
        await ctx.close();
      }
    }

    for (const theme of THEMES) {
      console.log(`${theme}:`);
      const ctx = await newContext(browser, theme, 390);
      await signIn(ctx, joeyEmail, 'Joey');
      const page = await ctx.newPage();
      for (const [name, route] of signedIn) await shoot(page, route, `${name}-${theme}`);
      await ctx.close();

      const out = await newContext(browser, theme, 390);
      const outPage = await out.newPage();
      for (const [name, route] of signedOut) await shoot(outPage, route, `${name}-${theme}`);
      await out.close();

      // The narrowest phone we support.
      const narrow = await newContext(browser, theme, 360);
      await signIn(narrow, joeyEmail, 'Joey');
      const narrowPage = await narrow.newPage();
      await shoot(narrowPage, r, `event-360-${theme}`);
      await shoot(narrowPage, `/l/${scored.slug}/admin/r/${scored.roundId}`, `admin-round-360-${theme}`);
      await narrow.close();
    }
  } finally {
    await cleanup(scored.leagueId, []);
    await cleanup(live.leagueId, [joeyId, momId]);
    await browser.close();
  }

  console.log(`Saved to ${OUT}`);
  if (overflows.length > 0) {
    console.error(`Sideways scroll on ${overflows.length} page(s):\n${overflows.join('\n')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
