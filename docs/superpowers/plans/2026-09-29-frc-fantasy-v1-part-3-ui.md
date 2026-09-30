# FRC Fantasy v1 — Part 3: Pages, Admin UI, Deploy (Tasks 22–28)

> Part of `2026-09-29-frc-fantasy-v1.md`. Read that file first: its **Global Constraints**, **Deviations**, and **Review Focus** apply to every task here. Parts 1 and 2 must be finished.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md`

Every commit message ends with a blank line and then:
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`

## How Part 3 is tested

Vitest runs in plain Node with no browser, so it tests **logic**, not pixels. Every task pulls its logic out of the React components into small pure functions (`lib/format.ts`, `lib/views/*`, `lib/draft.ts`, `lib/admin/client.ts`) and tests those. The components themselves stay thin and are checked two ways:

1. `npm run typecheck && npm run build` must pass.
2. A **manual check in the browser at 360px wide**, using the demo league from Task 22. Each task lists exactly what to look at.

To get a 360px view: open the page in Chrome, press `Cmd+Option+I`, press `Cmd+Shift+M`, and set the width box to `360`.

## UI rules for every component in this part

- Tap targets are at least 44px tall: buttons and tappable rows use `min-h-11`.
- Nothing scrolls sideways at 360px. Long names use `truncate` inside a `min-w-0` flex child.
- Numbers that line up in columns use `tabular-nums`.
- Pages under `app/l/` are server components that export `dynamic = 'force-dynamic'`. Interactive parts live in `components/` with `'use client'` at the top.
- Never pass a whole `LeagueRow` to a client component. It contains `adminTokenHash`.

---

### Task 22: Page data loaders, text formatting, and a demo league

**Files:**
- Create: `lib/format.ts`, `lib/views/round.ts`, `lib/views/league.ts`
- Create: `scripts/seed-demo.ts`
- Test: `tests/format.test.ts`, `tests/views/views.test.ts`

**Interfaces:**
- Consumes: `getRepo` (Task 12); `loadEventData` (Task 13); `scoreEvent` (Task 8); `scoreRound`, `seasonStandings`, `roundPlayers`, `pickerFor` (Task 9); `roundStatus`, `cacheWindowFor` (Task 10); `isUuid` (Task 15); `teamLabel` (Task 3); fixture files from Task 11.
- Produces from `@/lib/format`:
  - `agoLabel(fetchedAt: string | null, now: Date): string`
  - `freshnessText(fetchedAt: string | null, stale: boolean, now: Date): string`
  - `formatDateRange(start: string, end: string): string`
  - `signed(n: number): string` — `+5`, `-3`, `+0`
  - `lineText(line: { label: string; points: number }): string` — `Qual record 7-2-0 → +21`
  - `teamName(teamKey: string, names: Record<string, string>): string` — `341 Miss Daisy`, or `341` with no nickname
  - `tbaEventUrl(eventKey: string): string`
- Produces from `@/lib/views/round`:
  - `type RoundView` (Step 3)
  - `cleanEventData(data: EventData): EventData`
  - `buildRoundView(round: RoundRow, allPlayers: PlayerRow[], picks: PickRow[], adjustments: AdjustmentRow[], now: Date): Promise<RoundView>`
  - `type RoundPage = { league: { slug: string; name: string }; view: RoundView; playerNames: Record<string, string> }`
  - `loadRoundPage(slug: string, roundId: string, now: Date): Promise<RoundPage | null>`
- Produces from `@/lib/views/league`:
  - `type LeaguePage = { league: { slug: string; name: string }; standings: SeasonRow[]; rounds: RoundView[]; anyLive: boolean; fetchedAt: string | null; stale: boolean }`
  - `loadLeaguePage(slug: string, now: Date): Promise<LeaguePage | null>`
- Produces: CLI `npx tsx --env-file=.env.local scripts/seed-demo.ts [site-url]`

- [ ] **Step 1: Write the failing format test**

`tests/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  formatDateRange,
  freshnessText,
  lineText,
  signed,
  tbaEventUrl,
  teamName,
} from '@/lib/format';

const NOW = new Date('2026-10-24T18:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

describe('agoLabel', () => {
  it('describes how long ago something happened', () => {
    expect(agoLabel(ago(5 * SEC), NOW)).toBe('just now');
    expect(agoLabel(ago(59 * SEC), NOW)).toBe('just now');
    expect(agoLabel(ago(60 * SEC), NOW)).toBe('1 min ago');
    expect(agoLabel(ago(14 * MIN + 30 * SEC), NOW)).toBe('14 min ago');
    expect(agoLabel(ago(59 * MIN), NOW)).toBe('59 min ago');
    expect(agoLabel(ago(60 * MIN), NOW)).toBe('1 hr ago');
    expect(agoLabel(ago(47 * HOUR), NOW)).toBe('47 hr ago');
    expect(agoLabel(ago(48 * HOUR), NOW)).toBe('2 days ago');
  });
  it('handles never, the future, and garbage', () => {
    expect(agoLabel(null, NOW)).toBe('never');
    expect(agoLabel(new Date(NOW.getTime() + MIN).toISOString(), NOW)).toBe('just now');
    expect(agoLabel('not a date', NOW)).toBe('never');
  });
});

describe('freshnessText (§8.1)', () => {
  it('says when the data was last updated', () => {
    expect(freshnessText(ago(2 * MIN), false, NOW)).toBe('Last updated 2 min ago');
  });
  it('warns when the data is stale', () => {
    expect(freshnessText(ago(14 * MIN), true, NOW)).toBe('Scores may be behind — last updated 14 min ago');
  });
  it('explains when there has never been any data', () => {
    expect(freshnessText(null, true, NOW)).toBe("Couldn't reach The Blue Alliance yet");
    expect(freshnessText(null, false, NOW)).toBe('No data from The Blue Alliance yet');
  });
});

describe('formatDateRange', () => {
  it('formats single days, ranges, and ranges across months and years', () => {
    expect(formatDateRange('2026-10-24', '2026-10-24')).toBe('Oct 24, 2026');
    expect(formatDateRange('2026-04-15', '2026-04-18')).toBe('Apr 15–18, 2026');
    expect(formatDateRange('2026-10-31', '2026-11-01')).toBe('Oct 31 – Nov 1, 2026');
    expect(formatDateRange('2026-12-31', '2027-01-01')).toBe('Dec 31, 2026 – Jan 1, 2027');
  });
});

describe('signed and lineText', () => {
  it('always shows a sign', () => {
    expect(signed(5)).toBe('+5');
    expect(signed(0)).toBe('+0');
    expect(signed(-3)).toBe('-3');
  });
  it('matches the breakdown format in the spec (§5.3)', () => {
    expect(lineText({ label: 'Qual record 7-2-0', points: 21 })).toBe('Qual record 7-2-0 → +21');
    expect(lineText({ label: 'Adjustment: Late to draft', points: -10 })).toBe('Adjustment: Late to draft → -10');
  });
});

describe('teamName', () => {
  it('adds the nickname when there is one', () => {
    expect(teamName('frc341', { frc341: 'Miss Daisy' })).toBe('341 Miss Daisy');
    expect(teamName('frc341B', {})).toBe('341B');
  });
});

describe('tbaEventUrl', () => {
  it('links to the event on TBA', () => {
    expect(tbaEventUrl('2025parr')).toBe('https://www.thebluealliance.com/event/2025parr');
  });
});
```

- [ ] **Step 2: Run it, watch it fail, implement, watch it pass**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL, cannot resolve `@/lib/format`.

`lib/format.ts`:

```ts
import { teamLabel } from '@/lib/teams';

export function agoLabel(fetchedAt: string | null, now: Date): string {
  if (!fetchedAt) return 'never';
  const then = Date.parse(fetchedAt);
  if (Number.isNaN(then)) return 'never';
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function freshnessText(fetchedAt: string | null, stale: boolean, now: Date): string {
  if (!fetchedAt) {
    return stale ? "Couldn't reach The Blue Alliance yet" : 'No data from The Blue Alliance yet';
  }
  const ago = agoLabel(fetchedAt, now);
  return stale ? `Scores may be behind — last updated ${ago}` : `Last updated ${ago}`;
}

function parts(date: string): { month: string; day: number; year: number } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    day: d.getUTCDate(),
    year: d.getUTCFullYear(),
  };
}

export function formatDateRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.month} ${a.day}, ${a.year}`;
  if (a.year !== b.year) return `${a.month} ${a.day}, ${a.year} – ${b.month} ${b.day}, ${b.year}`;
  if (a.month !== b.month) return `${a.month} ${a.day} – ${b.month} ${b.day}, ${a.year}`;
  return `${a.month} ${a.day}–${b.day}, ${a.year}`;
}

export function signed(n: number): string {
  return n < 0 ? `${n}` : `+${n}`;
}

export function lineText(line: { label: string; points: number }): string {
  return `${line.label} → ${signed(line.points)}`;
}

export function teamName(teamKey: string, names: Record<string, string>): string {
  const nickname = names[teamKey];
  return nickname ? `${teamLabel(teamKey)} ${nickname}` : teamLabel(teamKey);
}

export function tbaEventUrl(eventKey: string): string {
  return `https://www.thebluealliance.com/event/${eventKey}`;
}
```

Run: `npx vitest run tests/format.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing views test**

`tests/views/views.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import type { EventData } from '@/lib/tba/types';
import { loadLeaguePage } from '@/lib/views/league';
import { cleanEventData, loadRoundPage } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { emptyEvent, match, rankRow, rankings } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-01T16:00:00.000Z');
const A0 = ['frc1', 'frc2', 'frc3'];
const A1 = ['frc4', 'frc5', 'frc6'];

/** Quals under way: frc1 is 2-0 and rank 1, frc4 is 1-1 and rank 2. */
function eventInProgress(): EventData {
  return {
    ...emptyEvent(),
    teams: [...A0, ...A1].map((key) => ({ key, team_number: Number(key.slice(3)), nickname: `Team ${key.slice(3)}` })),
    rankings: rankings([
      rankRow(1, 'frc1', [2, 0, 0], { extra_stats: [7] }),
      rankRow(2, 'frc4', [1, 1, 0], { extra_stats: [4] }),
    ]),
    matches: [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ num: 2, red: A0, blue: A1 }),
    ],
  };
}

/** Answers getTba by event key and endpoint. Unknown events have no data. */
function tba(events: Record<string, EventData>, opts: { stale?: boolean; fetchedAt?: string | null } = {}) {
  h.getTba = vi.fn(async (path: unknown) => {
    const m = /^\/event\/([^/]+)\/(teams|matches|rankings|alliances|awards|oprs)/.exec(String(path));
    const data = m ? (events[m[1]]?.[m[2] as keyof EventData] ?? null) : null;
    return {
      data,
      fetchedAt: opts.fetchedAt === undefined ? '2026-10-01T15:58:00.000Z' : opts.fetchedAt,
      stale: opts.stale ?? false,
    };
  });
}

let repo: Repo;
let league: LeagueRow;
let mom: PlayerRow;
let dad: PlayerRow;
let joey: PlayerRow;
let round: RoundRow;

async function newRound(eventKey: string, startDate: string) {
  return repo.createRound({
    leagueId: league.id, eventKey, eventName: `Event ${eventKey}`,
    startDate, endDate: startDate, timezone: 'America/New_York', scoring: defaultScoring(),
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
  mom = await repo.createPlayer(league.id, 'Mom');
  dad = await repo.createPlayer(league.id, 'Dad');
  joey = await repo.createPlayer(league.id, 'Joey');
  round = await newRound('2025parr', '2025-10-25');
  round = await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 1 });
  await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
  await repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: dad.id, teamKey: 'frc4' });
  await repo.insertAdjustment({ roundId: round.id, playerId: null, teamKey: 'frc1', points: 5, reason: 'Award' });
  tba({ '2025parr': eventInProgress() });
});

describe('loadRoundPage', () => {
  it('scores the round from TBA data, picks, and adjustments', async () => {
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.league).toEqual({ slug: league.slug, name: 'Habich Fam' });
    // frc1: 2 wins (6) + 7 RP + rank #1 (10) + adjustment 5 = 28. frc4: 3 + 4 + 5 = 12.
    expect(page.view.scores.map((s) => [s.name, s.total, s.rank])).toEqual([
      ['Mom', 28, 1],
      ['Dad', 12, 2],
    ]);
    expect(page.view.status).toBe('awaiting_final');
    expect(page.view.qualsComplete).toBe(false);
    expect(page.view.rpMethod).toBe('extra_stats');
    expect(page.view.hasEventData).toBe(true);
    expect(page.view.teamNames.frc1).toBe('Team 1');
    expect(page.view.fetchedAt).toBe('2026-10-01T15:58:00.000Z');
    expect(page.view.stale).toBe(false);
  });

  it('names every league player, including ones not in this round', async () => {
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.playerNames).toEqual({ [mom.id]: 'Mom', [dad.id]: 'Dad', [joey.id]: 'Joey' });
  });

  it('never exposes the admin token hash', async () => {
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(JSON.stringify(page)).not.toContain(league.adminTokenHash);
  });

  it('uses the round cache window when calling TBA', async () => {
    await loadRoundPage(league.slug, round.id, NOW);
    const calls = (h.getTba as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(6);
    for (const call of calls) expect(call[1]).toEqual({ windowMs: 10 * 60_000 }); // long after the event
  });

  it('shows zeros and "no event data" before the event has any results', async () => {
    tba({});
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.view.hasEventData).toBe(false);
    expect(page.view.scores.map((s) => [s.name, s.total])).toEqual([
      ['Mom', 5], // only the adjustment
      ['Dad', 0],
    ]);
  });

  it('passes the stale flag through', async () => {
    tba({ '2025parr': eventInProgress() }, { stale: true });
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.view.stale).toBe(true);
    expect(page.view.scores[0].total).toBe(28); // still shows the last good data
  });

  // Review Focus 3
  it('returns null for a bad id, an unknown league, or a round from another league', async () => {
    expect(await loadRoundPage(league.slug, 'not-a-uuid', NOW)).toBeNull();
    expect(await loadRoundPage(league.slug, '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b', NOW)).toBeNull();
    expect(await loadRoundPage('no-such-league', round.id, NOW)).toBeNull();
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    expect(await loadRoundPage(other.league.slug, round.id, NOW)).toBeNull();
  });
});

describe('cleanEventData', () => {
  it('replaces wrongly shaped sections with null so scoring cannot crash', () => {
    const broken = {
      teams: { Error: 'nope' },
      matches: 'oops',
      rankings: [],
      alliances: {},
      awards: 5,
      oprs: [],
    } as unknown as EventData;
    expect(cleanEventData(broken)).toEqual(emptyEvent());
  });

  it('keeps correctly shaped sections', () => {
    const good = eventInProgress();
    expect(cleanEventData(good)).toEqual(good);
  });
});

describe('loadLeaguePage', () => {
  it('adds rounds into season standings, including players who skipped a round', async () => {
    const round2 = await newRound('2026parr', '2026-10-24');
    await repo.updateRound(round2.id, { draftOrder: [joey.id], rosterSize: 1 });
    await repo.insertPick({ roundId: round2.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc4' });
    tba({ '2025parr': eventInProgress(), '2026parr': eventInProgress() });

    const page = (await loadLeaguePage(league.slug, NOW))!;
    expect(page.league).toEqual({ slug: league.slug, name: 'Habich Fam' });
    expect(page.rounds.map((r) => r.round.eventKey)).toEqual(['2025parr', '2026parr']);
    expect(page.standings).toEqual([
      { playerId: mom.id, name: 'Mom', total: 28, rank: 1, perRound: [28, 0] },
      { playerId: dad.id, name: 'Dad', total: 12, rank: 2, perRound: [12, 0] },
      { playerId: joey.id, name: 'Joey', total: 12, rank: 2, perRound: [0, 12] },
    ]);
    expect(page.anyLive).toBe(false);
  });

  it('knows when a round is live', async () => {
    const live = await newRound('2026parr', '2026-10-01');
    await repo.updateRound(live.id, { draftOrder: [joey.id], rosterSize: 1 });
    await repo.insertPick({ roundId: live.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc4' });
    const page = (await loadLeaguePage(league.slug, NOW))!;
    expect(page.anyLive).toBe(true);
    expect(page.rounds.find((r) => r.round.id === live.id)!.status).toBe('live');
  });

  it('reports the oldest fetch time and any staleness', async () => {
    tba({ '2025parr': eventInProgress() }, { stale: true, fetchedAt: '2026-10-01T15:00:00.000Z' });
    const page = (await loadLeaguePage(league.slug, NOW))!;
    expect(page.fetchedAt).toBe('2026-10-01T15:00:00.000Z');
    expect(page.stale).toBe(true);
  });

  it('works for a league with no rounds or players', async () => {
    const empty = await seedLeague(repo, { slug: 'empty-league-cccccc', name: 'Empty' });
    const page = (await loadLeaguePage(empty.league.slug, NOW))!;
    expect(page).toMatchObject({ standings: [], rounds: [], anyLive: false, fetchedAt: null, stale: false });
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('returns null for an unknown league', async () => {
    expect(await loadLeaguePage('no-such-league', NOW)).toBeNull();
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run tests/views/views.test.ts`
Expected: FAIL, cannot resolve `@/lib/views/league`.

- [ ] **Step 5: Implement the loaders**

`lib/views/round.ts`:

```ts
import { isUuid } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { AdjustmentRow, PickRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { cacheWindowFor, roundStatus, type RoundStatus } from '@/lib/rounds/status';
import { scoreEvent } from '@/lib/scoring/engine';
import { roundPlayers, scoreRound } from '@/lib/scoring/round';
import type { PlayerRoundScore, RpMethod } from '@/lib/scoring/types';
import { loadEventData } from '@/lib/tba/event';
import type { EventData } from '@/lib/tba/types';

export type RoundView = {
  round: RoundRow;
  status: RoundStatus;
  /** One row per player in the round, already sorted and ranked. */
  scores: PlayerRoundScore[];
  picks: PickRow[];
  adjustments: AdjustmentRow[];
  /** teamKey -> nickname, for teams TBA knows about. */
  teamNames: Record<string, string>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
  /** False until TBA has at least one match or ranking for the event. */
  hasEventData: boolean;
  hasRankings: boolean;
  fetchedAt: string | null;
  stale: boolean;
};

export type RoundPage = {
  league: { slug: string; name: string };
  view: RoundView;
  /** Every player in the league: id -> name. */
  playerNames: Record<string, string>;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** TBA is trusted but not blindly: a section with the wrong shape is treated as "no data". */
export function cleanEventData(data: EventData): EventData {
  return {
    teams: Array.isArray(data.teams) ? data.teams : null,
    matches: Array.isArray(data.matches) ? data.matches : null,
    rankings: isObject(data.rankings) ? data.rankings : null,
    alliances: Array.isArray(data.alliances) ? data.alliances : null,
    awards: Array.isArray(data.awards) ? data.awards : null,
    oprs: isObject(data.oprs) ? data.oprs : null,
  };
}

export async function buildRoundView(
  round: RoundRow,
  allPlayers: PlayerRow[],
  picks: PickRow[],
  adjustments: AdjustmentRow[],
  now: Date,
): Promise<RoundView> {
  const loaded = await loadEventData(round.eventKey, { windowMs: cacheWindowFor(round, now) });
  const data = cleanEventData(loaded.data);
  const event = scoreEvent(data, round.scoring);
  const players = roundPlayers(allPlayers, round.draftOrder, adjustments);

  const teamNames: Record<string, string> = {};
  for (const t of data.teams ?? []) if (t.nickname) teamNames[t.key] = t.nickname;

  const rankingCount = Array.isArray(data.rankings?.rankings) ? data.rankings.rankings.length : 0;
  return {
    round,
    status: roundStatus(round, picks.length, now),
    scores: scoreRound(event.teams, picks, adjustments, players),
    picks,
    adjustments,
    teamNames,
    qualsComplete: event.qualsComplete,
    rpMethod: event.rpMethod,
    hasEventData: (data.matches?.length ?? 0) > 0 || rankingCount > 0,
    hasRankings: rankingCount > 0,
    fetchedAt: loaded.fetchedAt,
    stale: loaded.stale,
  };
}

export async function loadRoundPage(slug: string, roundId: string, now: Date): Promise<RoundPage | null> {
  if (!isUuid(roundId)) return null;
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) return null;
  const round = await repo.getRound(roundId);
  if (!round || round.leagueId !== league.id) return null;

  const [allPlayers, picks, adjustments] = await Promise.all([
    repo.listPlayers(league.id),
    repo.listPicks(round.id),
    repo.listAdjustments(round.id),
  ]);
  return {
    league: { slug: league.slug, name: league.name },
    view: await buildRoundView(round, allPlayers, picks, adjustments, now),
    playerNames: Object.fromEntries(allPlayers.map((p) => [p.id, p.name])),
  };
}
```

`lib/views/league.ts`:

```ts
import { getRepo } from '@/lib/db';
import { seasonStandings } from '@/lib/scoring/round';
import type { SeasonRow } from '@/lib/scoring/types';
import { buildRoundView, type RoundView } from '@/lib/views/round';

export type LeaguePage = {
  league: { slug: string; name: string };
  standings: SeasonRow[];
  /** In date order. */
  rounds: RoundView[];
  anyLive: boolean;
  /** The oldest fetch among the rounds: the honest "last updated". */
  fetchedAt: string | null;
  stale: boolean;
};

export async function loadLeaguePage(slug: string, now: Date): Promise<LeaguePage | null> {
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) return null;

  const [players, rounds] = await Promise.all([repo.listPlayers(league.id), repo.listRounds(league.id)]);
  const roundIds = rounds.map((r) => r.id);
  const [picks, adjustments] = await Promise.all([
    repo.listPicksForRounds(roundIds),
    repo.listAdjustmentsForRounds(roundIds),
  ]);

  const views = await Promise.all(
    rounds.map((round) =>
      buildRoundView(
        round,
        players,
        picks.filter((p) => p.roundId === round.id),
        adjustments.filter((a) => a.roundId === round.id),
        now,
      ),
    ),
  );

  const times = views.map((v) => v.fetchedAt).filter((t): t is string => t !== null);
  return {
    league: { slug: league.slug, name: league.name },
    standings: seasonStandings(players, views.map((v) => v.scores)),
    rounds: views,
    anyLive: views.some((v) => v.status === 'live'),
    fetchedAt: times.length > 0 ? times.sort()[0] : null,
    stale: views.some((v) => v.stale),
  };
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run tests/views tests/format.test.ts && npm run typecheck`
Expected: PASS; typecheck prints nothing.

- [ ] **Step 7: Write the demo league script**

This makes a real league in the real database so there is something to look at while building pages.

`scripts/seed-demo.ts`:

```ts
// Creates a demo league that replays Ramp Riot 2025, with a finished draft.
// Usage: npx tsx --env-file=.env.local scripts/seed-demo.ts [site-url]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateAdminToken, hashToken, makeSlug } from '@/lib/auth/commissioner';
import { adminLink } from '@/lib/auth/rotate';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';
import { pickerFor } from '@/lib/scoring/round';
import type { TbaEvent, TeamSimple } from '@/lib/tba/types';
import { mergePool } from '@/lib/teams';

function fixture<T>(name: string): T {
  const file = path.join(process.cwd(), 'tests', 'fixtures', '2025parr', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

async function main() {
  const origin = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
  const repo = createSupabaseRepo(createSupabaseClient());
  const event = fixture<TbaEvent>('event');
  const pool = mergePool(fixture<TeamSimple[]>('teams'), []);

  const token = generateAdminToken();
  const league = await repo.createLeague({
    slug: makeSlug('Demo Fam'),
    name: 'Demo Fam',
    adminTokenHash: hashToken(token),
    defaultScoring: defaultScoring(),
  });

  const players = [];
  for (const name of ['Joey', 'Mom', 'Dad', 'A Very Long Player Name To Test Truncation']) {
    players.push(await repo.createPlayer(league.id, name));
  }

  const round = await repo.createRound({
    leagueId: league.id,
    eventKey: event.key,
    eventName: event.name,
    startDate: event.start_date,
    endDate: event.end_date,
    timezone: event.timezone || 'America/New_York',
    scoring: defaultScoring(),
  });
  const draftOrder = players.map((p) => p.id);
  const rosterSize = 4;
  await repo.updateRound(round.id, { draftOrder, rosterSize });

  // Spread picks across the pool so rosters are a mix of strong and weak teams.
  const step = Math.max(1, Math.floor(pool.length / (draftOrder.length * rosterSize)));
  for (let n = 0; n < draftOrder.length * rosterSize; n++) {
    await repo.insertPick({
      roundId: round.id,
      pickNumber: n,
      playerId: pickerFor(n, draftOrder),
      teamKey: pool[n * step].teamKey,
    });
  }
  await repo.insertAdjustment({
    roundId: round.id, playerId: players[1].id, teamKey: null, points: -5, reason: 'Late to the draft',
  });
  await repo.insertAdjustment({
    roundId: round.id, playerId: null, teamKey: pool[0].teamKey, points: 5, reason: 'Industrial Design Award',
  });

  console.log(`Public link: ${origin}/l/${league.slug}`);
  console.log(`Round page:  ${origin}/l/${league.slug}/r/${round.id}`);
  console.log(`Admin link:  ${adminLink(origin, league.slug, token)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

Run it and keep the three links it prints. Tasks 23–27 use them.

```bash
npx tsx --env-file=.env.local scripts/seed-demo.ts
```

Expected: three links, all starting with `http://localhost:3000/l/demo-fam-`.

- [ ] **Step 8: Commit**

```bash
git add lib/format.ts lib/views scripts/seed-demo.ts tests/format.test.ts tests/views
git commit -m "feat: page data loaders, text formatting, demo league script"
```

---

### Task 23: Public round page

**Files:**
- Create: `components/StatusBadge.tsx`, `components/Freshness.tsx`, `components/AutoRefresh.tsx`, `components/Leaderboard.tsx`, `components/RosterList.tsx`, `components/DraftBoard.tsx`, `components/AdjustmentList.tsx`
- Create: `app/l/[slug]/r/[roundId]/page.tsx`

**Interfaces:**
- Consumes: `loadRoundPage`, `RoundView` (Task 22); `freshnessText`, `formatDateRange`, `lineText`, `signed`, `teamName`, `tbaEventUrl` (Task 22); `STATUS_LABEL`, `RoundStatus` (Task 10); `PlayerRoundScore` (Task 4).
- Produces (all named exports):
  - `StatusBadge({ status }: { status: RoundStatus })`
  - `Freshness({ fetchedAt, stale, now }: { fetchedAt: string | null; stale: boolean; now: Date })`
  - `AutoRefresh({ seconds }: { seconds?: number })` — client component, renders nothing
  - `Leaderboard({ rows, emptyText }: { rows: LeaderboardRow[]; emptyText: string })` with `type LeaderboardRow = { id: string; rank: number; name: string; total: number; detail?: string }`
  - `RosterList({ scores, teamNames, draftInProgress }: { scores: PlayerRoundScore[]; teamNames: Record<string, string>; draftInProgress: boolean })`
  - `DraftBoard({ picks, draftOrder, rosterSize, playerNames, teamNames }: { picks: { pickNumber: number; playerId: string; teamKey: string }[]; draftOrder: string[]; rosterSize: number; playerNames: Record<string, string>; teamNames: Record<string, string> })`
  - `AdjustmentList({ adjustments, playerNames, teamNames }: { adjustments: { id: string; playerId: string | null; teamKey: string | null; points: number; reason: string }[]; playerNames: Record<string, string>; teamNames: Record<string, string> })`

- [ ] **Step 1: Write the small display components**

`components/StatusBadge.tsx`:

```tsx
import { STATUS_LABEL, type RoundStatus } from '@/lib/rounds/status';

const COLORS: Record<RoundStatus, string> = {
  setup: 'bg-slate-100 text-slate-700',
  drafting: 'bg-amber-100 text-amber-800',
  upcoming: 'bg-sky-100 text-sky-800',
  live: 'bg-green-100 text-green-800',
  awaiting_final: 'bg-orange-100 text-orange-800',
  final: 'bg-slate-800 text-white',
};

export function StatusBadge({ status }: { status: RoundStatus }) {
  return (
    <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${COLORS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
```

`components/Freshness.tsx`:

```tsx
import { freshnessText } from '@/lib/format';

export function Freshness({
  fetchedAt,
  stale,
  now,
}: {
  fetchedAt: string | null;
  stale: boolean;
  now: Date;
}) {
  return (
    <p
      className={
        stale
          ? 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'
          : 'text-sm text-slate-500'
      }
      role={stale ? 'status' : undefined}
    >
      {freshnessText(fetchedAt, stale, now)}
    </p>
  );
}
```

`components/AutoRefresh.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-renders the server page on a timer, but only while the tab is visible (spec §5.2). */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(refreshIfVisible, seconds * 1000);
    // Coming back to the tab after a while should not show minutes-old scores.
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [router, seconds]);

  return null;
}
```

`components/Leaderboard.tsx`:

```tsx
export type LeaderboardRow = {
  id: string;
  rank: number;
  name: string;
  total: number;
  /** Small grey text under the name, such as a per-round breakdown. */
  detail?: string;
};

export function Leaderboard({ rows, emptyText }: { rows: LeaderboardRow[]; emptyText: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <ol className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {rows.map((row) => (
        <li key={row.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
          <span className="w-6 shrink-0 text-center font-semibold text-slate-500 tabular-nums">{row.rank}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium" title={row.name}>
              {row.name}
            </span>
            {row.detail ? (
              <span className="block truncate text-xs text-slate-500 tabular-nums">{row.detail}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-lg font-bold tabular-nums">{row.total}</span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: Write the roster, draft board, and adjustment components**

`components/RosterList.tsx`. It uses the browser's built-in `<details>` element for tap-to-expand, so it needs no JavaScript:

```tsx
import { lineText, teamName } from '@/lib/format';
import type { PlayerRoundScore } from '@/lib/scoring/types';

export function RosterList({
  scores,
  teamNames,
  draftInProgress,
}: {
  scores: PlayerRoundScore[];
  teamNames: Record<string, string>;
  draftInProgress: boolean;
}) {
  if (scores.length === 0) return <p className="text-sm text-slate-500">No players in this round yet.</p>;
  return (
    <div className="space-y-2">
      {scores.map((player) => (
        <details key={player.playerId} className="rounded-lg border border-slate-200">
          <summary className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-medium">{player.name}</span>
            <span className="shrink-0 text-sm text-slate-500">
              {player.teams.length === 0 && draftInProgress
                ? 'draft in progress'
                : `${player.teams.length} ${player.teams.length === 1 ? 'team' : 'teams'}`}
            </span>
            <span className="shrink-0 font-bold tabular-nums">{player.total}</span>
          </summary>

          <div className="space-y-3 border-t border-slate-200 px-3 py-3">
            {/* The summary truncates long names. Here the full name is shown (spec §8.5). */}
            <p className="break-words text-sm font-semibold">{player.name}</p>

            {player.teams.map((team) => {
              const lines = team.lines.filter((l) => l.points !== 0);
              return (
                <div key={team.teamKey}>
                  <p className="break-words font-medium">
                    {teamName(team.teamKey, teamNames)} — {team.total} pts
                  </p>
                  {lines.length === 0 ? (
                    <p className="text-sm text-slate-500">No points yet</p>
                  ) : (
                    <ul className="text-sm text-slate-700">
                      {lines.map((line, i) => (
                        <li key={i} className="break-words tabular-nums">
                          {lineText(line)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {player.adjustments.length > 0 ? (
              <div>
                <p className="font-medium">Player adjustments</p>
                <ul className="text-sm text-slate-700">
                  {player.adjustments.map((line, i) => (
                    <li key={i} className="break-words tabular-nums">
                      {lineText(line)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
```

`components/DraftBoard.tsx`. One block per draft round, picks in the order they were made. The cells wrap, so the board never scrolls sideways however many players there are:

```tsx
import { teamLabel } from '@/lib/teams';

type BoardPick = { pickNumber: number; playerId: string; teamKey: string };

export function DraftBoard({
  picks,
  draftOrder,
  rosterSize,
  playerNames,
  teamNames,
}: {
  picks: BoardPick[];
  draftOrder: string[];
  rosterSize: number;
  playerNames: Record<string, string>;
  teamNames: Record<string, string>;
}) {
  const P = draftOrder.length;
  if (P === 0) return <p className="text-sm text-slate-500">The draft order hasn&apos;t been set yet.</p>;

  const byNumber = new Map(picks.map((p) => [p.pickNumber, p]));
  const draftRounds = Array.from({ length: rosterSize }, (_, r) => r);

  return (
    <div className="space-y-3">
      {draftRounds.map((r) => (
        <div key={r}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Round {r + 1}</p>
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {Array.from({ length: P }, (_, slot) => {
              const n = r * P + slot;
              const pick = byNumber.get(n);
              // Snake order: even rounds go forward through the order, odd rounds go backward.
              const pickerId = r % 2 === 0 ? draftOrder[slot] : draftOrder[P - 1 - slot];
              const who = playerNames[pick?.playerId ?? pickerId] ?? 'Unknown';
              return (
                <li
                  key={n}
                  className={`min-w-0 rounded-md border px-2 py-1 ${
                    pick ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50'
                  }`}
                >
                  <p className="truncate text-xs text-slate-500" title={who}>
                    #{n + 1} {who}
                  </p>
                  <p className="truncate font-semibold tabular-nums" title={pick ? teamNames[pick.teamKey] : undefined}>
                    {pick ? teamLabel(pick.teamKey) : '—'}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
```

`components/AdjustmentList.tsx`:

```tsx
import { signed, teamName } from '@/lib/format';

type ListedAdjustment = {
  id: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};

export function AdjustmentList({
  adjustments,
  playerNames,
  teamNames,
}: {
  adjustments: ListedAdjustment[];
  playerNames: Record<string, string>;
  teamNames: Record<string, string>;
}) {
  if (adjustments.length === 0) return <p className="text-sm text-slate-500">No adjustments.</p>;
  return (
    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {adjustments.map((a) => {
        const target = a.playerId
          ? (playerNames[a.playerId] ?? 'Unknown player')
          : `Team ${teamName(a.teamKey ?? '', teamNames)}`;
        return (
          <li key={a.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={target}>
                {target}
              </span>
              <span className="block break-words text-sm text-slate-600">{a.reason}</span>
            </span>
            <span className="shrink-0 font-bold tabular-nums">{signed(a.points)}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Write the page**

`app/l/[slug]/r/[roundId]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdjustmentList } from '@/components/AdjustmentList';
import { AutoRefresh } from '@/components/AutoRefresh';
import { DraftBoard } from '@/components/DraftBoard';
import { Freshness } from '@/components/Freshness';
import { Leaderboard } from '@/components/Leaderboard';
import { RosterList } from '@/components/RosterList';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateRange, tbaEventUrl } from '@/lib/format';
import { loadRoundPage } from '@/lib/views/round';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string; roundId: string }> };

export default async function RoundPage({ params }: Props) {
  const { slug, roundId } = await params;
  const now = new Date();
  const page = await loadRoundPage(slug, roundId, now);
  if (!page) notFound();

  const { league, view, playerNames } = page;
  const { round } = view;
  const draftInProgress = view.status === 'setup' || view.status === 'drafting';

  return (
    <main className="space-y-6">
      {view.status === 'live' ? <AutoRefresh seconds={60} /> : null}

      <header className="space-y-1">
        <Link href={`/l/${league.slug}`} className="inline-flex min-h-11 items-center text-sm text-sky-700 underline">
          ← {league.name}
        </Link>
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 break-words text-2xl font-bold">{round.eventName}</h1>
          <StatusBadge status={view.status} />
        </div>
        <p className="text-sm text-slate-600">{formatDateRange(round.startDate, round.endDate)}</p>
        <a
          href={tbaEventUrl(round.eventKey)}
          className="inline-flex min-h-11 items-center text-sm text-sky-700 underline"
          target="_blank"
          rel="noreferrer"
        >
          View on The Blue Alliance
        </a>
        <Freshness fetchedAt={view.fetchedAt} stale={view.stale} now={now} />
      </header>

      {!view.hasEventData ? (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">Event hasn&apos;t started</p>
      ) : null}
      {view.hasEventData && !view.qualsComplete ? (
        <p className="text-sm text-slate-500">OPR bonus: after quals</p>
      ) : null}
      {view.hasRankings && view.rpMethod === 'none' ? (
        <p className="text-sm text-slate-500">RP data unavailable for this event</p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Leaderboard</h2>
        <Leaderboard
          rows={view.scores.map((s) => ({ id: s.playerId, rank: s.rank, name: s.name, total: s.total }))}
          emptyText="No players in this round yet."
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Rosters</h2>
        <p className="text-sm text-slate-500">Tap a player to see where their points came from.</p>
        <RosterList scores={view.scores} teamNames={view.teamNames} draftInProgress={draftInProgress} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Draft board</h2>
        <DraftBoard
          picks={view.picks}
          draftOrder={round.draftOrder}
          rosterSize={round.rosterSize}
          playerNames={playerNames}
          teamNames={view.teamNames}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Adjustments</h2>
        <AdjustmentList adjustments={view.adjustments} playerNames={playerNames} teamNames={view.teamNames} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Check it builds**

Run: `npm run typecheck && npm run build`
Expected: no errors. The route table shows `/l/[slug]/r/[roundId]` as dynamic (`ƒ`).

- [ ] **Step 5: Check it in the browser at 360px**

Run `npm run dev` and open the **Round page** link from Task 22 at 360px wide. Confirm each of these:

1. The leaderboard shows four players with whole-number totals, highest first.
2. The long player name is cut off with `…` in the leaderboard and does not push the score off the screen.
3. Tapping a player opens their roster; the full long name is readable inside.
4. Each team shows lines such as `Qual record 7-2-0 → +21`, and no line shows `+0`.
5. Mom's breakdown has "Player adjustments" with `Adjustment: Late to the draft → -5`.
6. One team shows `Adjustment: Industrial Design Award → +5`.
7. The draft board shows 4 rounds of 4 picks, 16 cells, none empty.
8. The page does not scroll sideways.
9. The badge says "Awaiting final".
10. Opening `/l/<slug>/r/not-a-uuid` shows a 404 page, not an error.

Fix anything that fails before moving on.

- [ ] **Step 6: Commit**

```bash
git add components "app/l/[slug]/r"
git commit -m "feat: public round page"
```

---

### Task 24: Public league page and friendly error pages

**Files:**
- Create: `app/l/[slug]/page.tsx`, `app/l/[slug]/error.tsx`, `app/l/[slug]/not-found.tsx`

**Interfaces:**
- Consumes: `loadLeaguePage`, `LeaguePage` (Task 22); `Leaderboard`, `StatusBadge`, `Freshness`, `AutoRefresh` (Task 23); `formatDateRange` (Task 22); `DB_ASLEEP_MESSAGE` wording from Task 15.
- Produces: the page at `/l/{slug}`; an error boundary and a not-found page that cover every route under `/l/{slug}/`.

- [ ] **Step 1: Write the league page**

`app/l/[slug]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Freshness } from '@/components/Freshness';
import { Leaderboard } from '@/components/Leaderboard';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateRange } from '@/lib/format';
import { loadLeaguePage } from '@/lib/views/league';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string }> };

export default async function LeaguePage({ params }: Props) {
  const { slug } = await params;
  const now = new Date();
  const page = await loadLeaguePage(slug, now);
  if (!page) notFound();

  const { league, standings, rounds } = page;
  const live = rounds.filter((r) => r.status === 'live');

  return (
    <main className="space-y-6">
      {page.anyLive ? <AutoRefresh seconds={60} /> : null}

      <header className="space-y-1">
        <h1 className="break-words text-2xl font-bold">{league.name}</h1>
        {rounds.length > 0 ? <Freshness fetchedAt={page.fetchedAt} stale={page.stale} now={now} /> : null}
      </header>

      {live.map((view) => (
        <section key={view.round.id} className="space-y-2 rounded-xl border-2 border-green-600 p-3">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 break-words text-lg font-semibold">{view.round.eventName}</h2>
            <StatusBadge status={view.status} />
          </div>
          <Leaderboard
            rows={view.scores.map((s) => ({ id: s.playerId, rank: s.rank, name: s.name, total: s.total }))}
            emptyText="No players in this round yet."
          />
          <Link
            href={`/l/${league.slug}/r/${view.round.id}`}
            className="inline-flex min-h-11 items-center text-sm text-sky-700 underline"
          >
            See rosters and breakdowns
          </Link>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Season standings</h2>
        <Leaderboard
          rows={standings.map((s) => ({
            id: s.playerId,
            rank: s.rank,
            name: s.name,
            total: s.total,
            detail: s.perRound.length > 1 ? s.perRound.join(' · ') : undefined,
          }))}
          emptyText="No players yet. The commissioner adds them."
        />
        {rounds.length > 1 ? (
          <p className="text-xs text-slate-500">Small numbers are points per round, in date order.</p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Rounds</h2>
        {rounds.length === 0 ? (
          <p className="text-sm text-slate-500">No rounds yet. The commissioner adds them.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {rounds.map((view) => (
              <li key={view.round.id}>
                <Link
                  href={`/l/${league.slug}/r/${view.round.id}`}
                  className="flex min-h-11 items-center gap-3 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={view.round.eventName}>
                      {view.round.eventName}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {formatDateRange(view.round.startDate, view.round.endDate)}
                    </span>
                  </span>
                  <StatusBadge status={view.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Write the error and not-found pages**

`app/l/[slug]/error.tsx`. Error boundaries must be client components. In production, Next.js hides the real error message from the browser, so this page shows one friendly message for every failure; the most likely cause by far is the paused database (spec §8.2):

```tsx
'use client';

import { useEffect } from 'react';

export default function LeagueError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">The league database is asleep</h1>
      <p className="text-slate-700">The commissioner needs to wake it up. Your picks and scores are safe.</p>
      <p className="text-sm text-slate-500">
        If you are the commissioner: open the Supabase dashboard and press &ldquo;Restore project&rdquo;, wait
        a minute, then try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="min-h-11 rounded-lg bg-slate-900 px-4 font-semibold text-white"
      >
        Try again
      </button>
    </main>
  );
}
```

`app/l/[slug]/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function LeagueNotFound() {
  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">Nothing here</h1>
      <p className="text-slate-700">
        That league or round doesn&apos;t exist. Check the link in the group chat, or ask the commissioner for
        a new one.
      </p>
      <Link href="/" className="inline-flex min-h-11 items-center text-sky-700 underline">
        FRC Fantasy home
      </Link>
    </main>
  );
}
```

- [ ] **Step 3: Check it builds**

Run: `npm run typecheck && npm run build`
Expected: no errors; `/l/[slug]` is dynamic (`ƒ`).

- [ ] **Step 4: Check it in the browser at 360px**

With `npm run dev` running, open the **Public link** from Task 22:

1. The league name, season standings with four players, and one round in the Rounds list all show.
2. Tapping the round opens the round page; the back link returns here.
3. `/l/no-such-league-abc234` shows "Nothing here".
4. The page does not scroll sideways.

Then check the "database is asleep" page. Stop the dev server and start it with a broken database address:

```bash
SUPABASE_URL=https://does-not-exist.invalid npm run dev
```

Open the public link again. Expected: "The league database is asleep", not a stack trace. (In dev mode Next.js may also show its red error overlay on top; close it with `Esc` and the friendly page is underneath.) Stop the server and start it normally again.

- [ ] **Step 5: Commit**

```bash
git add "app/l/[slug]/page.tsx" "app/l/[slug]/error.tsx" "app/l/[slug]/not-found.tsx"
git commit -m "feat: public league page and friendly error pages"
```

---

### Task 25: Home page and "Create league"

**Files:**
- Create: `lib/admin/client.ts`
- Create: `components/CopyButton.tsx`, `components/CreateLeagueForm.tsx`
- Modify: `app/page.tsx` (replace the placeholder from Task 1)
- Test: `tests/admin/client.test.ts`

**Interfaces:**
- Consumes: `POST /api/leagues` (Task 16); the admin API (Tasks 16–20).
- Produces from `@/lib/admin/client` (browser-safe: no Node imports):
  - `class ApiError extends Error { status: number }` — `status` is `0` when the network failed
  - `storageKey(slug: string): string` — `frcf:admin:{slug}`
  - `tokenFromHash(hash: string): string | null`
  - `adminLinkFor(origin: string, slug: string, token: string): string`
  - `createLeague(name: string, passcode: string, fetchImpl?: typeof fetch): Promise<{ slug: string; adminToken: string }>`
  - `adminFetch<T>(slug: string, token: string, path: string, init?: { method?: string; body?: unknown }, fetchImpl?: typeof fetch): Promise<T>` — `path` is relative to `/api/l/{slug}/admin`, e.g. `/state`
  - `type AdminApi = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>`
- Produces: `CopyButton({ text, label }: { text: string; label: string })`, `CreateLeagueForm()`

- [ ] **Step 1: Write the failing test**

`tests/admin/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  adminFetch,
  adminLinkFor,
  ApiError,
  createLeague,
  storageKey,
  tokenFromHash,
} from '@/lib/admin/client';

const TOKEN = 'A'.repeat(43);

function respond(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('storageKey', () => {
  it('matches the spec (§4)', () => {
    expect(storageKey('habich-fam-k3x9qd')).toBe('frcf:admin:habich-fam-k3x9qd');
  });
});

describe('tokenFromHash', () => {
  it('reads the token from #k=...', () => {
    expect(tokenFromHash(`#k=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`k=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#other=1&k=${TOKEN}`)).toBe(TOKEN);
  });
  it('returns null when there is no usable token', () => {
    for (const hash of ['', '#', '#k=', '#k=short', '#token=abc', `#k=${'A'.repeat(300)}`, '#k=has spaces in it!!!!!!!!!!!!']) {
      expect(tokenFromHash(hash), hash).toBeNull();
    }
  });
});

describe('adminLinkFor', () => {
  it('puts the token in the fragment', () => {
    expect(adminLinkFor('https://x.test', 'fam-abc234', TOKEN)).toBe(`https://x.test/l/fam-abc234/admin#k=${TOKEN}`);
  });
});

describe('adminFetch', () => {
  it('sends the token header, JSON body, and no-store to the right URL', async () => {
    const fetchImpl = respond(200, { ok: true });
    const out = await adminFetch('fam-abc234', TOKEN, '/players', { method: 'POST', body: { name: 'Mom' } }, fetchImpl);
    expect(out).toEqual({ ok: true });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/l/fam-abc234/admin/players');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe('{"name":"Mom"}');
    const headers = new Headers(init.headers);
    expect(headers.get('x-commissioner-key')).toBe(TOKEN);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('defaults to GET with no body', async () => {
    const fetchImpl = respond(200, {});
    await adminFetch('fam-abc234', TOKEN, '/state', {}, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    expect(await adminFetch('s', TOKEN, '/x', { method: 'DELETE' }, respond(204))).toBeUndefined();
  });

  it('throws ApiError with the server message', async () => {
    const attempt = adminFetch('s', TOKEN, '/x', {}, respond(409, { error: 'That team was just taken' }));
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 409, message: 'That team was just taken' });
  });

  it('throws ApiError with a fallback message when the body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(adminFetch('s', TOKEN, '/x', {}, fetchImpl)).rejects.toMatchObject({
      status: 502,
      message: 'Something went wrong (502)',
    });
  });

  it('throws ApiError with status 0 when the network fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(adminFetch('s', TOKEN, '/x', {}, fetchImpl)).rejects.toMatchObject({
      status: 0,
      message: "Couldn't reach the server. Check your connection.",
    });
  });
});

describe('createLeague', () => {
  it('posts the name and passcode and returns the slug and token', async () => {
    const fetchImpl = respond(201, { slug: 'fam-abc234', adminToken: TOKEN });
    const out = await createLeague('Fam', 'open sesame', fetchImpl);
    expect(out).toEqual({ slug: 'fam-abc234', adminToken: TOKEN });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/leagues');
    expect(init.body).toBe('{"name":"Fam","passcode":"open sesame"}');
  });

  it('throws the server message for a wrong passcode', async () => {
    const attempt = createLeague('Fam', 'nope', respond(403, { error: 'Wrong passcode' }));
    await expect(attempt).rejects.toMatchObject({ status: 403, message: 'Wrong passcode' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/admin/client.test.ts`
Expected: FAIL, cannot resolve `@/lib/admin/client`.

- [ ] **Step 3: Implement the client helpers**

`lib/admin/client.ts`:

```ts
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
```

Run: `npx vitest run tests/admin/client.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the components and the page**

`components/CopyButton.tsx`:

```tsx
'use client';

import { useState } from 'react';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (for example in an in-app browser). Fall back to a prompt to copy by hand.
      window.prompt('Copy this link:', text);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="min-h-11 shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-semibold"
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}
```

`components/CreateLeagueForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { adminLinkFor, createLeague } from '@/lib/admin/client';

type Created = { publicLink: string; adminLink: string };

export function CreateLeagueForm() {
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { slug, adminToken } = await createLeague(name, passcode);
      const origin = window.location.origin;
      setCreated({ publicLink: `${origin}/l/${slug}`, adminLink: adminLinkFor(origin, slug, adminToken) });
      setPasscode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">League created</h2>

        <div className="space-y-2 rounded-lg border-2 border-red-600 bg-red-50 p-3">
          <p className="font-semibold text-red-900">Save your admin link now.</p>
          <p className="text-sm text-red-900">
            It is shown only this once and can&apos;t be recovered from the app. Anyone with this link can
            change the league, so don&apos;t post it in the group chat.
          </p>
          <p className="break-all rounded bg-white p-2 font-mono text-xs">{created.adminLink}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={created.adminLink} label="Copy admin link" />
            <a
              href={created.adminLink}
              className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white"
            >
              Open admin page
            </a>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <p className="font-semibold">Public link (for the group chat)</p>
          <p className="break-all rounded bg-slate-50 p-2 font-mono text-xs">{created.publicLink}</p>
          <CopyButton text={created.publicLink} label="Copy public link" />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-lg font-semibold">Create a league</h2>
      <label className="block space-y-1">
        <span className="text-sm font-medium">League name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          className="h-11 w-full rounded-lg border border-slate-300 px-3"
          placeholder="Habich Fam"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Site passcode</span>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          maxLength={200}
          required
          autoComplete="off"
          className="h-11 w-full rounded-lg border border-slate-300 px-3"
        />
      </label>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 w-full rounded-lg bg-slate-900 px-4 font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create league'}
      </button>
    </form>
  );
}
```

Replace `app/page.tsx` with:

```tsx
import { CreateLeagueForm } from '@/components/CreateLeagueForm';

export default function HomePage() {
  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">FRC Fantasy</h1>
        <p className="text-slate-700">
          Fantasy drafts for FIRST Robotics Competition. Before an event, everyone takes turns drafting the
          teams that are competing. Your teams earn points for winning matches, ranking high, getting picked
          for playoff alliances, and winning the event. Scores come straight from The Blue Alliance.
        </p>
        <p className="text-slate-700">
          Looking for your league? Use the link from your group chat.
        </p>
      </header>
      <CreateLeagueForm />
    </main>
  );
}
```

- [ ] **Step 5: Check it builds, then check it in the browser at 360px**

Run: `npm run typecheck && npm run build`
Expected: no errors.

With `npm run dev` running, open `http://localhost:3000`:

1. A wrong passcode shows "Wrong passcode" and creates nothing.
2. The right passcode (from `.env.local`) shows both links and the red "save your admin link" box.
3. The admin link contains `#k=` followed by 43 characters.
4. "Copy admin link" copies it (paste into the address bar to confirm).
5. The public link opens an empty league page with "No players yet" and "No rounds yet".
6. The long links wrap and nothing scrolls sideways.

- [ ] **Step 6: Commit**

```bash
git add lib/admin components/CopyButton.tsx components/CreateLeagueForm.tsx app/page.tsx tests/admin
git commit -m "feat: home page and league creation"
```

---

### Task 26: Commissioner dashboard

**Files:**
- Create: `components/admin/useAdmin.ts`, `components/admin/AdminGate.tsx`, `components/admin/ScoringForm.tsx`, `components/admin/AdminDashboard.tsx`
- Create: `app/l/[slug]/admin/page.tsx`

**Interfaces:**
- Consumes: `adminFetch`, `ApiError`, `AdminApi`, `storageKey`, `tokenFromHash` (Task 25); `AdminState` (Task 16); `scoringConfigSchema`, `defaultScoring`, `ScoringConfig` (Task 2); `StatusBadge` (Task 23); `CopyButton` (Task 25); `formatDateRange` (Task 22).
- Produces:
  - `useAdmin(slug: string): AdminSession` where `type AdminSession = { status: 'checking' } | { status: 'invalid' } | { status: 'error'; message: string } | { status: 'ready'; api: AdminApi }`
  - `AdminGate({ slug, children }: { slug: string; children: (api: AdminApi) => React.ReactNode })`
  - `ScoringForm({ initial, saveLabel, onSave }: { initial: ScoringConfig; saveLabel: string; onSave: (config: ScoringConfig) => Promise<void> })`
  - `AdminDashboard({ slug }: { slug: string })`
  - Button style constants exported from `AdminGate.tsx`: `BTN`, `BTN_PRIMARY`, `BTN_DANGER`, `INPUT`

**Deviation 6 (flagged in the index file):** spec §5.4 says adding a round "shows event name/dates for confirmation". The API in §9.3 has no look-up-only endpoint, so the dashboard adds the round and then shows its name and dates with a Delete button beside it. A wrong event is one tap to remove.

- [ ] **Step 1: Write the session hook and the gate**

`components/admin/useAdmin.ts`:

```ts
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
```

`components/admin/AdminGate.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { useAdmin } from '@/components/admin/useAdmin';
import type { AdminApi } from '@/lib/admin/client';

// Shared styles so every admin control has a 44px tap target.
export const BTN = 'min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50';
export const BTN_PRIMARY = 'min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50';
export const BTN_DANGER = 'min-h-11 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-800 disabled:opacity-50';
export const INPUT = 'h-11 min-w-0 rounded-lg border border-slate-300 px-3';

export function AdminGate({ slug, children }: { slug: string; children: (api: AdminApi) => ReactNode }) {
  const session = useAdmin(slug);

  if (session.status === 'checking') return <p className="text-slate-500">Checking your admin link…</p>;
  if (session.status === 'invalid') {
    return <h1 className="text-xl font-bold">This admin link is invalid</h1>;
  }
  if (session.status === 'error') {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Can&apos;t load the admin page</h1>
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {session.message}
        </p>
        <button type="button" className={BTN_PRIMARY} onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  return <>{children(session.api)}</>;
}
```

- [ ] **Step 2: Write the scoring form**

`components/admin/ScoringForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { BTN, BTN_PRIMARY } from '@/components/admin/AdminGate';
import { defaultScoring, scoringConfigSchema, type ScoringConfig } from '@/lib/scoring/config';

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <input
        type="number"
        step={1}
        value={Number.isNaN(value) ? '' : value}
        // An empty box becomes NaN, which fails validation with a clear message instead of silently saving 0.
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        className="h-11 w-20 shrink-0 rounded-lg border border-slate-300 px-2 text-right tabular-nums"
      />
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function ScoringForm({
  initial,
  saveLabel,
  onSave,
}: {
  initial: ScoringConfig;
  saveLabel: string;
  onSave: (config: ScoringConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ScoringConfig>(() => structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<ScoringConfig>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  async function save() {
    setError(null);
    const parsed = scoringConfigSchema.safeParse(draft);
    if (!parsed.success) {
      setError('Every box needs a whole number from -1000 to 1000, and rank tiers must go in ascending order.');
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Group title="Qualification matches">
        <NumberField label="Per win" value={draft.qualWin} onChange={(v) => set({ qualWin: v })} />
        <NumberField label="Per tie" value={draft.qualTie} onChange={(v) => set({ qualTie: v })} />
        <NumberField label="Per loss" value={draft.qualLoss} onChange={(v) => set({ qualLoss: v })} />
        <NumberField label="Per ranking point" value={draft.rankingPoint} onChange={(v) => set({ rankingPoint: v })} />
      </Group>

      <Group title="Qualification rank">
        {draft.rankTiers.map((tier, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Rank</span>
            <input
              type="number"
              step={1}
              min={1}
              aria-label={`Tier ${i + 1}: up to rank`}
              value={Number.isNaN(tier.maxRank) ? '' : tier.maxRank}
              onChange={(e) =>
                set({
                  rankTiers: draft.rankTiers.map((t, j) =>
                    j === i ? { ...t, maxRank: e.target.value === '' ? Number.NaN : Number(e.target.value) } : t,
                  ),
                })
              }
              className="h-11 w-16 rounded-lg border border-slate-300 px-2 text-right tabular-nums"
            />
            <span className="text-sm">or better →</span>
            <input
              type="number"
              step={1}
              aria-label={`Tier ${i + 1}: points`}
              value={Number.isNaN(tier.points) ? '' : tier.points}
              onChange={(e) =>
                set({
                  rankTiers: draft.rankTiers.map((t, j) =>
                    j === i ? { ...t, points: e.target.value === '' ? Number.NaN : Number(e.target.value) } : t,
                  ),
                })
              }
              className="h-11 w-16 rounded-lg border border-slate-300 px-2 text-right tabular-nums"
            />
            <button
              type="button"
              className={BTN}
              aria-label={`Remove tier ${i + 1}`}
              onClick={() => set({ rankTiers: draft.rankTiers.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className={BTN}
          disabled={draft.rankTiers.length >= 20}
          onClick={() => {
            const last = draft.rankTiers.at(-1);
            set({ rankTiers: [...draft.rankTiers, { maxRank: (last?.maxRank ?? 0) + 8, points: 1 }] });
          }}
        >
          Add tier
        </button>
        <p className="text-xs text-slate-500">A team gets the first tier it fits. Ranks below the last tier get 0.</p>
      </Group>

      <Group title="Alliance selection">
        <NumberField label="Captain" value={draft.alliance.captain} onChange={(v) => set({ alliance: { ...draft.alliance, captain: v } })} />
        <NumberField label="First pick" value={draft.alliance.pick1} onChange={(v) => set({ alliance: { ...draft.alliance, pick1: v } })} />
        <NumberField label="Second pick" value={draft.alliance.pick2} onChange={(v) => set({ alliance: { ...draft.alliance, pick2: v } })} />
        <NumberField label="Third pick" value={draft.alliance.pick3} onChange={(v) => set({ alliance: { ...draft.alliance, pick3: v } })} />
        <NumberField label="Backup robot" value={draft.alliance.backup} onChange={(v) => set({ alliance: { ...draft.alliance, backup: v } })} />
      </Group>

      <Group title="Playoffs">
        <NumberField label="Per playoff match win" value={draft.playoffMatchWin} onChange={(v) => set({ playoffMatchWin: v })} />
        <NumberField label="Event winner" value={draft.eventWinner} onChange={(v) => set({ eventWinner: v })} />
        <NumberField label="Event finalist" value={draft.eventFinalist} onChange={(v) => set({ eventFinalist: v })} />
      </Group>

      <Group title="Awards">
        {(
          [
            ['0', 'Impact Award'],
            ['9', 'Engineering Inspiration'],
            ['10', 'Rookie All-Star'],
          ] as const
        ).map(([type, label]) => (
          <NumberField
            key={type}
            label={label}
            value={draft.awards.byType[type] ?? draft.awards.default}
            onChange={(v) => set({ awards: { ...draft.awards, byType: { ...draft.awards.byType, [type]: v } } })}
          />
        ))}
        <NumberField
          label="Any other team award"
          value={draft.awards.default}
          onChange={(v) => set({ awards: { ...draft.awards, default: v } })}
        />
        <p className="text-xs text-slate-500">
          Winner, finalist, seed, and individual awards never score here. Offseason events usually have no
          awards on The Blue Alliance, so add those as adjustments.
        </p>
      </Group>

      <Group title="OPR bonus (after quals)">
        {draft.oprBonus.map((points, i) => (
          <NumberField
            key={i}
            label={`OPR rank #${i + 1}`}
            value={points}
            onChange={(v) => set({ oprBonus: draft.oprBonus.map((p, j) => (j === i ? v : p)) })}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN}
            disabled={draft.oprBonus.length >= 10}
            onClick={() => set({ oprBonus: [...draft.oprBonus, 1] })}
          >
            Add a place
          </button>
          <button
            type="button"
            className={BTN}
            disabled={draft.oprBonus.length === 0}
            onClick={() => set({ oprBonus: draft.oprBonus.slice(0, -1) })}
          >
            Remove last place
          </button>
        </div>
      </Group>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-sm text-green-800">Saved.</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={save}>
          {busy ? 'Saving…' : saveLabel}
        </button>
        <button
          type="button"
          className={BTN}
          disabled={busy}
          onClick={() => {
            setSaved(false);
            setError(null);
            setDraft(defaultScoring());
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the dashboard**

`components/admin/AdminDashboard.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminGate, BTN, BTN_DANGER, BTN_PRIMARY, INPUT } from '@/components/admin/AdminGate';
import { ScoringForm } from '@/components/admin/ScoringForm';
import { CopyButton } from '@/components/CopyButton';
import { StatusBadge } from '@/components/StatusBadge';
import type { AdminApi } from '@/lib/admin/client';
import type { AdminPlayer, AdminState } from '@/lib/api/types';
import { formatDateRange } from '@/lib/format';

export function AdminDashboard({ slug }: { slug: string }) {
  return <AdminGate slug={slug}>{(api) => <Dashboard slug={slug} api={api} />}</AdminGate>;
}

function Dashboard({ slug, api }: { slug: string; api: AdminApi }) {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setState(await api<AdminState>('/state'));
  }, [api]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, [reload]);

  /** Runs one change, then reloads so the screen always shows what the server has. */
  const run = useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        if (done) setNotice(done);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        await reload().catch(() => {});
        setBusy(false);
      }
    },
    [reload],
  );

  if (!state) {
    return error ? (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
        {error}
      </p>
    ) : (
      <p className="text-slate-500">Loading…</p>
    );
  }

  const publicLink = typeof window === 'undefined' ? '' : `${window.location.origin}/l/${slug}`;

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Commissioner</p>
        <h1 className="break-words text-2xl font-bold">{state.league.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/l/${slug}`} className={`${BTN} inline-flex items-center`}>
            View public page
          </Link>
          <CopyButton text={publicLink} label="Copy public link" />
        </div>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      {notice ? <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">{notice}</p> : null}

      <RenameLeague
        key={state.league.name}
        name={state.league.name}
        busy={busy}
        onSave={(name) => run(() => api('/league', { method: 'PATCH', body: { name } }), 'League renamed.')}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Players</h2>
        {state.players.length === 0 ? <p className="text-sm text-slate-500">No players yet.</p> : null}
        <ul className="space-y-2">
          {state.players.map((player) => (
            <PlayerRow
              key={`${player.id}:${player.name}`}
              player={player}
              busy={busy}
              onRename={(name) =>
                run(() => api(`/players/${player.id}`, { method: 'PATCH', body: { name } }))
              }
              onRemove={() => run(() => api(`/players/${player.id}`, { method: 'DELETE' }))}
            />
          ))}
        </ul>
        <AddForm
          label="Add a player"
          placeholder="Name"
          maxLength={40}
          button="Add player"
          busy={busy}
          onAdd={(name) => run(() => api('/players', { method: 'POST', body: { name } }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Rounds</h2>
        {state.rounds.length === 0 ? <p className="text-sm text-slate-500">No rounds yet.</p> : null}
        <ul className="space-y-2">
          {state.rounds.map((round) => (
            <li key={round.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{round.eventName}</p>
                  <p className="text-sm text-slate-500">
                    {formatDateRange(round.startDate, round.endDate)} · {round.eventKey}
                  </p>
                  <p className="text-sm text-slate-500">
                    {round.totalPicks === 0
                      ? 'Draft not set up'
                      : `${round.pickCount} of ${round.totalPicks} picks`}
                  </p>
                </div>
                <StatusBadge status={round.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/l/${slug}/admin/r/${round.id}`} className={`${BTN_PRIMARY} inline-flex items-center`}>
                  Manage round
                </Link>
                <button
                  type="button"
                  className={BTN_DANGER}
                  disabled={busy}
                  onClick={() => {
                    const sure = window.confirm(
                      `Delete ${round.eventName}? This also deletes its picks and adjustments. It can't be undone.`,
                    );
                    if (sure) run(() => api(`/rounds/${round.id}`, { method: 'DELETE' }), 'Round deleted.');
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        <AddForm
          label="Add a round by event key"
          placeholder="2026parr"
          maxLength={40}
          button="Add round"
          busy={busy}
          onAdd={(eventKey) =>
            run(async () => {
              const out = await api<{ round: { eventName: string; startDate: string; endDate: string } }>(
                '/rounds',
                { method: 'POST', body: { eventKey } },
              );
              setNotice(
                `Added ${out.round.eventName} (${formatDateRange(out.round.startDate, out.round.endDate)}). Wrong event? Delete it above.`,
              );
            })
          }
        />
        <p className="text-xs text-slate-500">
          The event key is the last part of the event&apos;s address on thebluealliance.com, such as 2026parr.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Default scoring</h2>
        <p className="text-sm text-slate-500">
          New rounds copy these values. Changing them does not change rounds that already exist.
        </p>
        <details className="rounded-lg border border-slate-200">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
            Edit default scoring
          </summary>
          <div className="border-t border-slate-200 p-3">
            <ScoringForm
              initial={state.league.defaultScoring}
              saveLabel="Save default scoring"
              onSave={async (defaultScoring) => {
                await api('/league', { method: 'PATCH', body: { defaultScoring } });
                await reload();
              }}
            />
          </div>
        </details>
      </section>
    </main>
  );
}

function RenameLeague({
  name,
  busy,
  onSave,
}: {
  name: string;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">League name</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          required
          aria-label="League name"
          className={`${INPUT} flex-1`}
        />
        <button type="submit" className={BTN} disabled={busy || value.trim() === '' || value.trim() === name}>
          Rename
        </button>
      </form>
    </section>
  );
}

function PlayerRow({
  player,
  busy,
  onRename,
  onRemove,
}: {
  player: AdminPlayer;
  busy: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(player.name);
  return (
    <li className="space-y-1 rounded-lg border border-slate-200 p-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(value);
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={40}
          required
          aria-label={`Name for ${player.name}`}
          className={`${INPUT} flex-1`}
        />
        <button type="submit" className={BTN} disabled={busy || value.trim() === '' || value.trim() === player.name}>
          Rename
        </button>
        <button type="button" className={BTN_DANGER} disabled={busy || player.inUse} onClick={onRemove}>
          Remove
        </button>
      </form>
      {player.inUse ? (
        <p className="text-xs text-slate-500">
          Can&apos;t be removed: this player is in a draft order or has picks or adjustments. Renaming is fine.
        </p>
      ) : null}
    </li>
  );
}

function AddForm({
  label,
  placeholder,
  maxLength,
  button,
  busy,
  onAdd,
}: {
  label: string;
  placeholder: string;
  maxLength: number;
  button: string;
  busy: boolean;
  onAdd: (value: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        await onAdd(value);
        setValue('');
      }}
    >
      <label className="block text-sm font-medium">
        {label}
        <span className="mt-1 flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={maxLength}
            required
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            className={`${INPUT} flex-1 font-normal`}
          />
          <button type="submit" className={BTN_PRIMARY} disabled={busy || value.trim() === ''}>
            {button}
          </button>
        </span>
      </label>
    </form>
  );
}
```

Why the `key` props on `RenameLeague` and `PlayerRow` include the name: each holds its own text-box state. When a rename succeeds and the reloaded name changes, the changed `key` makes React rebuild the row with the new name, so the box never shows a stale value.

- [ ] **Step 4: Write the page shell**

`app/l/[slug]/admin/page.tsx`. This is a server component only so that it can export `dynamic`; everything visible is the client component. The server never sees the token, because URL fragments are not sent to servers:

```tsx
import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Commissioner — FRC Fantasy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ slug: string }> };

export default async function AdminPage({ params }: Props) {
  const { slug } = await params;
  return <AdminDashboard slug={slug} />;
}
```

- [ ] **Step 5: Check it builds, then check it in the browser at 360px**

Run: `npm run typecheck && npm run build`
Expected: no errors; `/l/[slug]/admin` is dynamic (`ƒ`).

With `npm run dev` running, open the **Admin link** from Task 22:

1. The dashboard loads, and the address bar no longer shows `#k=...`.
2. Reloading the page (now without the fragment) still loads the dashboard.
3. In a private window, `/l/<slug>/admin` with no fragment shows only "This admin link is invalid".
4. In a private window, the admin link with its last character changed shows "This admin link is invalid".
5. Add a player "Gran": she appears. Add "gran": the error "There's already a player with that name" shows.
6. Rename "Gran" to "Grandma": the row updates. Remove her: she disappears.
7. "Remove" is disabled for the four drafted players, with the explanation underneath.
8. Add round `2025parr` again: the error "That event is already in this league" shows.
9. Add round `2024parr`: a green notice shows its name and dates. Delete it, confirming the dialog.
10. Open "Edit default scoring", clear the "Per win" box, press Save: the validation message shows and nothing is saved. Set it to 3 and save: "Saved." shows.
11. Nothing scrolls sideways, and every button is comfortably tappable.

- [ ] **Step 6: Commit**

```bash
git add components/admin "app/l/[slug]/admin/page.tsx"
git commit -m "feat: commissioner dashboard"
```

---

### Task 27: Round admin: setup, draft entry, adjustments, finalize

**Files:**
- Create: `lib/draft.ts`
- Create: `components/admin/RoundAdmin.tsx`, `components/admin/RoundSetup.tsx`, `components/admin/DraftEntry.tsx`, `components/admin/AdjustmentEditor.tsx`
- Create: `app/l/[slug]/admin/r/[roundId]/page.tsx`
- Test: `tests/draft.test.ts`

**Interfaces:**
- Consumes: `AdminGate`, `BTN`, `BTN_PRIMARY`, `BTN_DANGER`, `INPUT` (Task 26); `ScoringForm` (Task 26); `AdminRoundDetail` (Task 18); `AdminApi` (Task 25); `DraftBoard`, `StatusBadge` (Task 23); `pickerFor` (Task 9); `parseTeamInput`, `teamLabel`, `PoolTeam` (Task 3); `signed`, `teamName`, `agoLabel`, `formatDateRange` (Task 22); the round endpoints (Tasks 18–20).
- Produces from `@/lib/draft`:
  - `draftBanner(args: { pickCount: number; draftOrder: string[]; rosterSize: number; playerNames: Record<string, string> }): string`
  - `availableTeams(pool: PoolTeam[], picks: { teamKey: string }[], query: string): PoolTeam[]`
  - `moveItem<T>(list: T[], index: number, delta: number): T[]`
  - `shuffled<T>(list: T[], random?: () => number): T[]`
- Produces: `RoundAdmin({ slug, roundId })` and the section components it uses. Every section takes `SectionProps = { detail: AdminRoundDetail; busy: boolean; run: (action: () => Promise<unknown>, done?: string) => Promise<void>; api: AdminApi; playerNames: Record<string, string> }`.

- [ ] **Step 1: Write the failing test**

`tests/draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { availableTeams, draftBanner, moveItem, shuffled } from '@/lib/draft';
import type { PoolTeam } from '@/lib/teams';

const names = { mom: 'Mom', dad: 'Dad', joey: 'Joey' };
const order = ['mom', 'dad', 'joey'];

describe('draftBanner (§5.5)', () => {
  it('says whose turn it is, which pick, and which draft round', () => {
    expect(draftBanner({ pickCount: 0, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      "Pick 1 of 6 — Mom's turn (round 1)",
    );
    expect(draftBanner({ pickCount: 3, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      "Pick 4 of 6 — Joey's turn (round 2)", // snake: round 2 goes Joey, Dad, Mom
    );
    expect(draftBanner({ pickCount: 5, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      "Pick 6 of 6 — Mom's turn (round 2)",
    );
  });
  it('knows when the draft is complete or not set up', () => {
    expect(draftBanner({ pickCount: 6, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      'Draft complete — 6 of 6 picks',
    );
    expect(draftBanner({ pickCount: 0, draftOrder: [], rosterSize: 2, playerNames: names })).toBe(
      'Set the draft order to start the draft',
    );
  });
});

describe('availableTeams', () => {
  const pool: PoolTeam[] = [
    { teamKey: 'frc341', label: '341', nickname: 'Miss Daisy', manual: false },
    { teamKey: 'frc3467', label: '3467', nickname: 'Windham Windup', manual: false },
    { teamKey: 'frc1234', label: '1234', nickname: null, manual: true },
    { teamKey: 'frc5181', label: '5181', nickname: 'Explorer Robotics', manual: false },
  ];

  it('hides drafted teams', () => {
    expect(availableTeams(pool, [{ teamKey: 'frc341' }], '').map((t) => t.teamKey)).toEqual([
      'frc3467', 'frc1234', 'frc5181',
    ]);
  });
  it('matches the start of a team number', () => {
    expect(availableTeams(pool, [], '34').map((t) => t.label)).toEqual(['341', '3467']);
    expect(availableTeams(pool, [], '234')).toEqual([]);
  });
  it('matches anywhere in the nickname, ignoring case', () => {
    expect(availableTeams(pool, [], 'DAISY').map((t) => t.label)).toEqual(['341']);
    expect(availableTeams(pool, [], 'robot').map((t) => t.label)).toEqual(['5181']);
  });
  it('ignores surrounding spaces and shows everything for an empty query', () => {
    expect(availableTeams(pool, [], '  341 ')).toHaveLength(1);
    expect(availableTeams(pool, [], '   ')).toHaveLength(4);
  });
});

describe('moveItem', () => {
  it('moves an item up or down and returns a new list', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(list, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('does nothing at the edges', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('shuffled', () => {
  it('returns a permutation and leaves the input alone', () => {
    const list = [1, 2, 3, 4, 5];
    const out = shuffled(list, () => 0.5);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(list).toEqual([1, 2, 3, 4, 5]);
  });
  it('can change the order', () => {
    let i = 0;
    const seq = [0.9, 0.1, 0.7, 0.3];
    expect(shuffled([1, 2, 3, 4, 5], () => seq[i++ % seq.length])).not.toEqual([1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, implement, watch it pass**

Run: `npx vitest run tests/draft.test.ts`
Expected: FAIL, cannot resolve `@/lib/draft`.

`lib/draft.ts`:

```ts
import { pickerFor } from '@/lib/scoring/round';
import type { PoolTeam } from '@/lib/teams';

export function draftBanner(args: {
  pickCount: number;
  draftOrder: string[];
  rosterSize: number;
  playerNames: Record<string, string>;
}): string {
  const { pickCount, draftOrder, rosterSize, playerNames } = args;
  const P = draftOrder.length;
  if (P === 0) return 'Set the draft order to start the draft';
  const total = P * rosterSize;
  if (pickCount >= total) return `Draft complete — ${total} of ${total} picks`;
  const picker = playerNames[pickerFor(pickCount, draftOrder)] ?? 'Unknown';
  const draftRound = Math.floor(pickCount / P) + 1;
  return `Pick ${pickCount + 1} of ${total} — ${picker}'s turn (round ${draftRound})`;
}

/** Teams still on the board, filtered by number prefix or nickname substring. */
export function availableTeams(pool: PoolTeam[], picks: { teamKey: string }[], query: string): PoolTeam[] {
  const taken = new Set(picks.map((p) => p.teamKey));
  const q = query.trim().toLowerCase();
  return pool.filter(
    (t) =>
      !taken.has(t.teamKey) &&
      (q === '' || t.label.toLowerCase().startsWith(q) || (t.nickname ?? '').toLowerCase().includes(q)),
  );
}

export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const out = [...list];
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

/** Fisher-Yates shuffle. `random` is injectable so tests are repeatable. */
export function shuffled<T>(list: T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

Run: `npx vitest run tests/draft.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the container**

`components/admin/RoundAdmin.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdjustmentEditor } from '@/components/admin/AdjustmentEditor';
import { AdminGate, BTN, BTN_PRIMARY } from '@/components/admin/AdminGate';
import { DraftEntry } from '@/components/admin/DraftEntry';
import { RoundSetup } from '@/components/admin/RoundSetup';
import { StatusBadge } from '@/components/StatusBadge';
import type { AdminApi } from '@/lib/admin/client';
import type { AdminRoundDetail } from '@/lib/api/types';
import { agoLabel, formatDateRange } from '@/lib/format';

export type SectionProps = {
  detail: AdminRoundDetail;
  busy: boolean;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
  api: AdminApi;
  playerNames: Record<string, string>;
};

export function RoundAdmin({ slug, roundId }: { slug: string; roundId: string }) {
  return <AdminGate slug={slug}>{(api) => <RoundManager slug={slug} roundId={roundId} api={api} />}</AdminGate>;
}

function RoundManager({ slug, roundId, api }: { slug: string; roundId: string; api: AdminApi }) {
  const [detail, setDetail] = useState<AdminRoundDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setDetail(await api<AdminRoundDetail>(`/rounds/${roundId}`));
  }, [api, roundId]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, [reload]);

  /** Runs one change, then reloads. A 409 from another tab shows its message and the fresh state. */
  const run = useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        if (done) setNotice(done);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        await reload().catch(() => {});
        setBusy(false);
      }
    },
    [reload],
  );

  if (!detail) {
    return error ? (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
        {error}
      </p>
    ) : (
      <p className="text-slate-500">Loading…</p>
    );
  }

  const playerNames = Object.fromEntries(detail.players.map((p) => [p.id, p.name]));
  const section: SectionProps = { detail, busy, run, api, playerNames };
  const { round } = detail;

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <Link href={`/l/${slug}/admin`} className="inline-flex min-h-11 items-center text-sm text-sky-700 underline">
          ← Commissioner dashboard
        </Link>
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 break-words text-2xl font-bold">{round.eventName}</h1>
          <StatusBadge status={detail.status} />
        </div>
        <p className="text-sm text-slate-500">
          {formatDateRange(round.startDate, round.endDate)} · {round.eventKey}
        </p>
        <Link href={`/l/${slug}/r/${round.id}`} className={`${BTN} inline-flex items-center`}>
          View public round page
        </Link>
      </header>

      {detail.nudgeFinalize ? (
        <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900">
          Event&apos;s over — mark final once results look complete.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      {notice ? <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">{notice}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Setup</h2>
        <details className="rounded-lg border border-slate-200" open={detail.status === 'setup'}>
          <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
            Roster size, draft order, team pool, scoring
          </summary>
          <div className="border-t border-slate-200 p-3">
            <RoundSetup key={`${round.draftOrder.join(',')}|${round.rosterSize}`} {...section} />
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Draft</h2>
        <DraftEntry {...section} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Adjustments</h2>
        <AdjustmentEditor {...section} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Data and status</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const out = await api<{ fetchedAt: string | null; stale: boolean }>(`/rounds/${round.id}/refresh`, {
                  method: 'POST',
                });
                setNotice(
                  out.stale
                    ? `Couldn't reach The Blue Alliance. Showing data from ${agoLabel(out.fetchedAt, new Date())}.`
                    : `Refreshed from The Blue Alliance (${agoLabel(out.fetchedAt, new Date())}).`,
                );
              })
            }
          >
            Refresh from TBA
          </button>
          {round.finalizedAt ? (
            <button
              type="button"
              className={BTN}
              disabled={busy}
              onClick={() => run(() => api(`/rounds/${round.id}`, { method: 'PATCH', body: { finalized: false } }), 'Round reopened.')}
            >
              Reopen round
            </button>
          ) : (
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy}
              onClick={() => run(() => api(`/rounds/${round.id}`, { method: 'PATCH', body: { finalized: true } }), 'Round marked final.')}
            >
              Mark round final
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Refresh is limited to once every 15 seconds. Marking final only changes the badge and slows down
          checks for new data; scores are always computed from The Blue Alliance.
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Write the setup section**

`components/admin/RoundSetup.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { BTN, BTN_DANGER, BTN_PRIMARY, INPUT } from '@/components/admin/AdminGate';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { ScoringForm } from '@/components/admin/ScoringForm';
import { moveItem, shuffled } from '@/lib/draft';
import { parseTeamInput } from '@/lib/teams';

export function RoundSetup({ detail, busy, run, api, playerNames }: SectionProps) {
  const { round } = detail;
  const locked = detail.picks.length > 0;
  const [order, setOrder] = useState<string[]>(round.draftOrder);
  const [rosterSize, setRosterSize] = useState(round.rosterSize);
  const [teamInput, setTeamInput] = useState('');

  const notDrafting = detail.players.filter((p) => !order.includes(p.id));
  const maxAllowed = order.length === 0 ? 10 : Math.min(10, Math.floor(detail.pool.length / order.length));
  const changed = rosterSize !== round.rosterSize || order.join(',') !== round.draftOrder.join(',');
  const manualTeams = detail.pool.filter((t) => t.manual);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-semibold">Draft order and roster size</h3>
        {locked ? (
          <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
            Undo all picks to change the draft order or roster size.
          </p>
        ) : null}

        <ol className="space-y-1">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-1 pl-3">
              <span className="w-5 text-sm text-slate-500 tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{playerNames[id] ?? 'Unknown'}</span>
              <button type="button" className={BTN} disabled={locked || i === 0} aria-label="Move up" onClick={() => setOrder(moveItem(order, i, -1))}>
                ↑
              </button>
              <button type="button" className={BTN} disabled={locked || i === order.length - 1} aria-label="Move down" onClick={() => setOrder(moveItem(order, i, 1))}>
                ↓
              </button>
              <button type="button" className={BTN_DANGER} disabled={locked} onClick={() => setOrder(order.filter((x) => x !== id))}>
                Out
              </button>
            </li>
          ))}
        </ol>
        {order.length === 0 ? <p className="text-sm text-slate-500">Nobody is drafting yet.</p> : null}

        {notDrafting.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {notDrafting.map((p) => (
              <button key={p.id} type="button" className={BTN} disabled={locked} onClick={() => setOrder([...order, p.id])}>
                + {p.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} disabled={locked || order.length < 2} onClick={() => setOrder(shuffled(order))}>
            Randomize order
          </button>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            Roster size
            <select
              value={rosterSize}
              disabled={locked}
              onChange={(e) => setRosterSize(Number(e.target.value))}
              className={`${INPUT} w-20`}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-500">
          {order.length} {order.length === 1 ? 'player' : 'players'} × {rosterSize} teams = {order.length * rosterSize}{' '}
          picks from a pool of {detail.pool.length}.{' '}
          {order.length > 0 ? `Roster size can be at most ${maxAllowed}.` : ''}
        </p>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy || locked || !changed || rosterSize > maxAllowed}
          onClick={() =>
            run(
              () => api(`/rounds/${round.id}`, { method: 'PATCH', body: { draftOrder: order, rosterSize } }),
              'Draft setup saved.',
            )
          }
        >
          Save draft setup
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Team pool</h3>
        {detail.poolStale ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Couldn&apos;t reach The Blue Alliance; the team list may be out of date.
          </p>
        ) : null}
        <p className="text-sm text-slate-600">
          {detail.pool.length - manualTeams.length} teams from The Blue Alliance, {manualTeams.length} added by hand.
          Offseason team lists are often incomplete until event day; add missing teams here.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const key = parseTeamInput(teamInput);
            if (!key) return;
            run(() => api(`/rounds/${round.id}/teams`, { method: 'POST', body: { teamNumber: teamInput } }), `Added ${key.slice(3)}.`);
            setTeamInput('');
          }}
        >
          <input
            value={teamInput}
            onChange={(e) => setTeamInput(e.target.value)}
            placeholder="Team number, e.g. 341 or 341B"
            aria-label="Team number to add"
            autoCapitalize="characters"
            className={`${INPUT} flex-1`}
          />
          <button type="submit" className={BTN_PRIMARY} disabled={busy || parseTeamInput(teamInput) === null}>
            Add team
          </button>
        </form>
        {manualTeams.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {manualTeams.map((t) => (
              <li key={t.teamKey} className="flex items-center gap-1 rounded-lg border border-slate-200 pl-3">
                <span className="tabular-nums">{t.label}</span>
                <button
                  type="button"
                  className={BTN_DANGER}
                  disabled={busy}
                  aria-label={`Take team ${t.label} out of the pool`}
                  onClick={() => run(() => api(`/rounds/${round.id}/teams/${t.teamKey}`, { method: 'DELETE' }))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Show all {detail.pool.length} teams</summary>
          <ul className="grid grid-cols-2 gap-1 text-sm">
            {detail.pool.map((t) => (
              <li key={t.teamKey} className="truncate">
                <span className="font-semibold tabular-nums">{t.label}</span> {t.nickname ?? ''}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Scoring for this round</h3>
        <p className="text-sm text-slate-500">Only this round changes. Scores update as soon as you save.</p>
        <ScoringForm
          initial={round.scoring}
          saveLabel="Save round scoring"
          onSave={(scoring) => run(() => api(`/rounds/${round.id}`, { method: 'PATCH', body: { scoring } }), 'Round scoring saved.')}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the draft entry section**

`components/admin/DraftEntry.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { BTN, BTN_DANGER, INPUT } from '@/components/admin/AdminGate';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { DraftBoard } from '@/components/DraftBoard';
import { availableTeams, draftBanner } from '@/lib/draft';
import { teamLabel } from '@/lib/teams';

const SHOW_AT_MOST = 60;

export function DraftEntry({ detail, busy, run, api, playerNames }: SectionProps) {
  const { round, picks, pool } = detail;
  const [query, setQuery] = useState('');
  const [replacing, setReplacing] = useState<number | null>(null);

  const total = round.draftOrder.length * round.rosterSize;
  const complete = total > 0 && picks.length >= total;
  const canPick = round.draftOrder.length > 0 && (!complete || replacing !== null);
  const available = availableTeams(pool, picks, query);
  const teamNames = Object.fromEntries(pool.map((t) => [t.teamKey, t.nickname ?? '']));

  function choose(teamKey: string) {
    setQuery('');
    if (replacing !== null) {
      const n = replacing;
      setReplacing(null);
      run(
        () => api(`/rounds/${round.id}/picks/${n}`, { method: 'PATCH', body: { teamKey } }),
        `Pick ${n + 1} is now ${teamLabel(teamKey)}.`,
      );
    } else {
      // expectedPickNumber makes a second tab's stale click fail loudly instead of double-picking.
      run(() => api(`/rounds/${round.id}/picks`, { method: 'POST', body: { expectedPickNumber: picks.length, teamKey } }));
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-slate-900 px-3 py-3 text-center text-lg font-semibold text-white">
        {draftBanner({ pickCount: picks.length, draftOrder: round.draftOrder, rosterSize: round.rosterSize, playerNames })}
      </p>

      {replacing !== null ? (
        <p className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Replacing pick {replacing + 1} ({teamLabel(picks[replacing]?.teamKey ?? '')}). Tap the new team.
          </span>
          <button type="button" className={BTN} onClick={() => setReplacing(null)}>
            Cancel
          </button>
        </p>
      ) : null}

      {canPick ? (
        <div className="space-y-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by number or name"
            aria-label="Search available teams"
            autoCapitalize="none"
            autoCorrect="off"
            className={`${INPUT} w-full`}
          />
          {available.length === 0 ? <p className="text-sm text-slate-500">No available teams match.</p> : null}
          <ul className="grid grid-cols-2 gap-2">
            {available.slice(0, SHOW_AT_MOST).map((t) => (
              <li key={t.teamKey}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(t.teamKey)}
                  className="flex min-h-11 w-full min-w-0 flex-col items-start rounded-lg border border-slate-300 px-3 py-1 text-left disabled:opacity-50"
                >
                  <span className="font-semibold tabular-nums">{t.label}</span>
                  <span className="w-full truncate text-xs text-slate-500">{t.nickname ?? (t.manual ? 'added by hand' : '')}</span>
                </button>
              </li>
            ))}
          </ul>
          {available.length > SHOW_AT_MOST ? (
            <p className="text-xs text-slate-500">Showing {SHOW_AT_MOST} of {available.length}. Type to narrow the list.</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_DANGER}
          disabled={busy || picks.length === 0}
          onClick={() => {
            const last = picks[picks.length - 1];
            setReplacing(null);
            run(() => api(`/rounds/${round.id}/picks/${last.pickNumber}`, { method: 'DELETE' }), `Undid pick ${last.pickNumber + 1}.`);
          }}
        >
          Undo last pick
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Draft board</h3>
        <DraftBoard
          picks={picks}
          draftOrder={round.draftOrder}
          rosterSize={round.rosterSize}
          playerNames={playerNames}
          teamNames={teamNames}
        />
      </div>

      {picks.length > 0 ? (
        <div className="space-y-1">
          <h3 className="font-semibold">Replace a pick</h3>
          <p className="text-xs text-slate-500">For a team that withdrew. The pick keeps its number and owner.</p>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {picks.map((p) => (
              <li key={p.pickNumber} className="flex min-h-11 items-center gap-2 px-3 py-1">
                <span className="w-8 text-sm text-slate-500 tabular-nums">#{p.pickNumber + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold tabular-nums">{teamLabel(p.teamKey)}</span>{' '}
                  <span className="text-sm text-slate-500">{playerNames[p.playerId] ?? 'Unknown'}</span>
                </span>
                <button type="button" className={BTN} disabled={busy} onClick={() => setReplacing(p.pickNumber)}>
                  Replace
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Write the adjustments section**

`components/admin/AdjustmentEditor.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { BTN, BTN_DANGER, BTN_PRIMARY, INPUT } from '@/components/admin/AdminGate';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { signed, teamName } from '@/lib/format';
import { parseTeamInput } from '@/lib/teams';

type Form = {
  id: string | null; // null = adding, otherwise editing this adjustment
  target: 'player' | 'team';
  playerId: string;
  team: string;
  points: string;
  reason: string;
};

export function AdjustmentEditor({ detail, busy, run, api, playerNames }: SectionProps) {
  const { round, adjustments } = detail;
  const empty: Form = { id: null, target: 'player', playerId: detail.players[0]?.id ?? '', team: '', points: '', reason: '' };
  const [form, setForm] = useState<Form>(empty);
  const [problem, setProblem] = useState<string | null>(null);
  const teamNames = Object.fromEntries(detail.pool.filter((t) => t.nickname).map((t) => [t.teamKey, t.nickname as string]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    const points = Number(form.points);
    if (!Number.isInteger(points) || points < -1000 || points > 1000) {
      setProblem('Points must be a whole number from -1000 to 1000.');
      return;
    }
    const teamKey = form.target === 'team' ? parseTeamInput(form.team) : null;
    if (form.target === 'team' && !teamKey) {
      setProblem('Team numbers look like 341 or 341B.');
      return;
    }
    const body = {
      ...(form.target === 'player' ? { playerId: form.playerId } : { teamKey }),
      points,
      reason: form.reason,
    };
    const request =
      form.id === null
        ? api(`/rounds/${round.id}/adjustments`, { method: 'POST', body })
        : api(`/rounds/${round.id}/adjustments/${form.id}`, { method: 'PATCH', body });
    run(() => request, form.id === null ? 'Adjustment added.' : 'Adjustment updated.').then(() => setForm(empty));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        For things The Blue Alliance doesn&apos;t score: offseason awards, a tied playoff match the refs
        decided, side bets. Everyone can see these and the reason.
      </p>

      <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p className="font-medium">{form.id === null ? 'Add an adjustment' : 'Edit adjustment'}</p>
        <div className="flex gap-2">
          {(['player', 'team'] as const).map((t) => (
            <label key={t} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name="target" checked={form.target === t} onChange={() => setForm({ ...form, target: t })} />
              {t === 'player' ? 'A player' : 'A team (goes to its owner)'}
            </label>
          ))}
        </div>
        {form.target === 'player' ? (
          <select value={form.playerId} onChange={(e) => setForm({ ...form, playerId: e.target.value })} aria-label="Player" className={`${INPUT} w-full`}>
            {detail.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="Team number" aria-label="Team number" className={`${INPUT} w-full`} />
        )}
        <div className="flex gap-2">
          <input type="number" step={1} value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} placeholder="Points" aria-label="Points" required className={`${INPUT} w-24 tabular-nums`} />
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason (everyone sees this)" aria-label="Reason" maxLength={200} required className={`${INPUT} flex-1`} />
        </div>
        {problem ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
            {problem}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={BTN_PRIMARY} disabled={busy || (form.target === 'player' && !form.playerId)}>
            {form.id === null ? 'Add adjustment' : 'Save changes'}
          </button>
          {form.id !== null ? (
            <button type="button" className={BTN} onClick={() => setForm(empty)}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {adjustments.length === 0 ? <p className="text-sm text-slate-500">No adjustments yet.</p> : null}
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
        {adjustments.map((a) => {
          const target = a.playerId ? (playerNames[a.playerId] ?? 'Unknown player') : `Team ${teamName(a.teamKey ?? '', teamNames)}`;
          return (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{target}</span>
                <span className="block break-words text-sm text-slate-600">{a.reason}</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">{signed(a.points)}</span>
              <button
                type="button"
                className={BTN}
                disabled={busy}
                onClick={() =>
                  setForm({
                    id: a.id,
                    target: a.playerId ? 'player' : 'team',
                    playerId: a.playerId ?? detail.players[0]?.id ?? '',
                    team: a.teamKey ? a.teamKey.slice(3) : '',
                    points: String(a.points),
                    reason: a.reason,
                  })
                }
              >
                Edit
              </button>
              <button
                type="button"
                className={BTN_DANGER}
                disabled={busy}
                onClick={() => run(() => api(`/rounds/${round.id}/adjustments/${a.id}`, { method: 'DELETE' }), 'Adjustment deleted.')}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Write the page shell**

`app/l/[slug]/admin/r/[roundId]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { RoundAdmin } from '@/components/admin/RoundAdmin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Round admin — FRC Fantasy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ slug: string; roundId: string }> };

export default async function RoundAdminPage({ params }: Props) {
  const { slug, roundId } = await params;
  return <RoundAdmin slug={slug} roundId={roundId} />;
}
```

- [ ] **Step 8: Check it builds, then run a full draft in the browser at 360px**

Run: `npm run typecheck && npm run build`
Expected: no errors; `/l/[slug]/admin/r/[roundId]` is dynamic (`ƒ`).

With `npm run dev` running, go to the dashboard from Task 22 and add round `2024parr` (Ramp Riot 2024), then press **Manage round**:

1. The Setup section is open. Add all four players, press "Randomize order", set roster size 3, press "Save draft setup". The badge still says "Setup".
2. Set roster size 10 and check the Save button is disabled with the "at most" note explaining why.
3. Add team `9999` by hand: it appears under the pool with an × button. Take it out again.
4. In Draft: the banner reads `Pick 1 of 12 — <first player>'s turn (round 1)`. Tap a team: it disappears from the list, the board fills a cell, and the banner moves to pick 2.
5. Type `34` in the search: only teams starting with 34 show. Type a nickname fragment: it matches too.
6. Draft until complete. The banner reads `Draft complete — 12 of 12 picks`, the team list is gone, and the badge says "Awaiting final".
7. Press "Undo last pick": the last cell empties and the team is back in the list. Draft it again.
8. Press "Replace" on pick 1, tap a different team: pick 1 shows the new team with the same owner.
9. Open the same round admin in a second tab, make a pick there, then try to pick in the first tab: "Draft changed in another tab — refresh" shows, and the page updates itself to the real state.
10. Setup now says "Undo all picks to change the draft order or roster size" and its controls are disabled.
11. Add a team adjustment for one of the drafted teams (+5, "Test award"), then a player adjustment (-3, "Late"). Edit the first to +6. Delete the second. Open the public round page: the +6 shows in that team's breakdown and in the Adjustments list.
12. Press "Refresh from TBA" twice quickly: both succeed; the second one just returns the cached time.
13. Press "Mark round final": badge says "Final". Press "Reopen round": it goes back to "Awaiting final".
14. Nothing scrolls sideways at any point.

Finally, delete the `2024parr` round from the dashboard.

- [ ] **Step 9: Commit**

```bash
git add lib/draft.ts tests/draft.test.ts components/admin "app/l/[slug]/admin/r"
git commit -m "feat: round admin with draft entry, adjustments, and finalize"
```

---

### Task 28: README, deploy to Vercel, prove caching, and the family replay

**Files:**
- Create: `README.md`
- Modify: `CLAUDE.md` (update "Current status")

**Interfaces:**
- Consumes: everything.
- Produces: a production URL, a README that a future Joey can follow, and a scored replay of Ramp Riot 2025 with the family.

- [ ] **Step 1: Write the README**

`README.md`:

````markdown
# FRC Fantasy

A fantasy draft league for FIRST Robotics Competition events, for family and friends. Before an event,
players take turns drafting the FRC teams competing there. Teams earn points from their real results on
The Blue Alliance. Each event is a round; rounds add up to season standings.

Design spec: `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md`.

## How it works

- **Public link** `/l/<slug>`: the group-chat link. Leaderboards, rosters, every point explained.
- **Admin link** `/l/<slug>/admin#k=<token>`: the commissioner's link. Shown once when the league is
  created. Keep it private; anyone with it can change the league.
- Scores are never stored. They are recomputed from The Blue Alliance data every time a page loads, using
  the round's scoring table, the picks, and any manual adjustments.

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill in the four values below
npm run dev                  # http://localhost:3000
```

| Variable | Where it comes from |
|---|---|
| `TBA_API_KEY` | thebluealliance.com/account → Read API Keys |
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → service_role key. Server only. Never in the browser. |
| `CREATE_LEAGUE_PASSCODE` | Anything you like. Needed to create a league on the home page. |

Database setup, once: paste `supabase/migrations/0001_init.sql` into the Supabase SQL Editor and run it.

## Checks

```bash
npm test             # unit tests (scoring engine, TBA client, API routes)
npm run typecheck
npm run build
npx tsx --env-file=.env.local scripts/db-smoke.ts   # talks to the real database
```

## Scripts

| Script | What it does |
|---|---|
| `scripts/capture-fixture.ts <eventKey>` | Downloads an event's TBA data into `tests/fixtures/` |
| `scripts/seed-demo.ts [site-url]` | Creates a demo league that replays Ramp Riot 2025 |
| `scripts/db-smoke.ts` | Checks the real database matches the code |
| `scripts/rotate-admin-token.ts <slug> [site-url]` | Makes a new admin link when the old one is lost |

Run them with `npx tsx --env-file=.env.local scripts/<name>.ts ...`.

## Lost the admin link?

```bash
npx tsx --env-file=.env.local scripts/rotate-admin-token.ts <slug> https://<your-app>.vercel.app
```

It prints a new admin link. The old one stops working.

## Before every event

1. **Wake the database.** Supabase free projects pause after about a week idle. Open the Supabase
   dashboard; if the project says "Paused", press "Restore project" and wait a minute. Do this the day
   before.
2. Open the public link on your phone and confirm it loads.
3. Check the event exists on The Blue Alliance and note its key (for Ramp Riot 2026, probably `2026parr`).
4. Add the round in the admin page and look at its team pool. Offseason lists are often incomplete: add
   missing teams by hand.
5. Set the draft order and roster size, then draft.

## During the event

- Pages refresh themselves every 60 seconds while a round is live.
- If The Blue Alliance is slow, pages show "Scores may be behind" and keep the last good numbers.
- "Refresh from TBA" in the round admin forces a check (at most once every 15 seconds).
- Things TBA doesn't have (offseason awards, a tied playoff match the refs decided) go in as
  **adjustments**, with a reason everyone can see.

## After the event

Results can keep arriving for a day or two. Once they look complete, press "Mark round final". That only
changes the badge and slows down data checks; the scores stay live.
````

- [ ] **Step 2: Put the repo on GitHub**

Skip any step that is already done.

```bash
gh auth status || gh auth login
gh repo create frc-fantasy --private --source=. --remote=origin --push
```

Expected: the repo exists at `github.com/<you>/frc-fantasy` and `git status` says the branch is up to date with `origin/main`. Confirm `.env.local` is not on GitHub: `gh repo view --web`, look at the file list.

- [ ] **Step 3: Deploy to Vercel**

1. At `https://vercel.com/new`, import the `frc-fantasy` repo. Framework preset: Next.js (detected). Leave build settings alone.
2. Under **Environment Variables**, add the four values from `.env.local`: `TBA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CREATE_LEAGUE_PASSCODE`.
3. Press **Deploy**. Expected: a green build and a URL like `https://frc-fantasy-xxxx.vercel.app`.
4. Open `https://<your-app>.vercel.app/`. Expected: the home page.

- [ ] **Step 4: Create the real league on production**

1. On the production home page, create the league (for example "Habich Fam") with the passcode.
2. **Save the admin link** in a password manager or a private note. Copy the public link too.
3. In the admin page, add the family as players and add round `2025parr` for the replay.

- [ ] **Step 5: Prove nothing is cached by Next.js (spec §9.2)**

This is the check that a leaderboard change shows up without redeploying:

1. Open the public round page for `2025parr` on your phone. Note a player's total.
2. On your laptop, in the round admin, add a player adjustment of +100 with the reason "cache test".
3. Reload the public page on the phone. Expected: the total is 100 higher, within a second or two, with no
   redeploy. If it is not, stop: something is caching. Check that the page exports
   `dynamic = 'force-dynamic'` and that no `fetch` lost its `cache: 'no-store'`.
4. Delete the "cache test" adjustment and reload again. Expected: the total is back.

- [ ] **Step 6: Family replay dry run (spec §10.8)**

At dinner, with the `2025parr` round on production:

1. Set the draft order (randomize), roster size 4, and run a real draft from the admin page on a phone.
   Everyone else watches the public page.
2. Look at the leaderboard and the breakdowns together. Ask: does the winner feel deserved? Are qual wins
   too heavy (spec §3.4.1)? Does the OPR bonus matter too much or too little?
3. Change values in the round's scoring form and watch the leaderboard move. When the table feels right,
   copy the same values into the league's **default scoring** so Ramp Riot 2026 uses them.
4. Add an adjustment for something the family thinks deserved points, to practice.
5. Mark the round final.

Write down what changed and why in `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` under a new
heading "Replay notes (2026-10-xx)" so the numbers are not forgotten.

- [ ] **Step 7: Update `CLAUDE.md` and commit**

In `CLAUDE.md`, replace the "Current status" section with:

```markdown
## Current status

- v1 is implemented from `docs/superpowers/plans/2026-09-29-frc-fantasy-v1*.md` and deployed on Vercel.
- The family replay of `2025parr` is done; scoring defaults were tuned (see "Replay notes" in the spec).
- Next: Priority 2 stretch items only if before Oct 19, otherwise polish and the Oct 23 draft.
```

Then:

```bash
git add README.md CLAUDE.md docs/superpowers/specs
git commit -m "docs: README, deployment notes, replay notes"
git push
```

Expected: Vercel redeploys from the push and the build stays green.

**Part 3 (and v1) is done when:** the production public link works on a phone, the caching check passed, the family replay is done and its notes are in the spec, and `npm test` is green.
