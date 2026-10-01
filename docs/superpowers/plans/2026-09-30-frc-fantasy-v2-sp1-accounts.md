# FRC Fantasy v2 — SP1 Accounts & Leagues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace v1's secret commissioner link with Google/Discord sign-in, make every player an account-holding league member (invite codes, roles, visibility), and give signed-in users a Me/Leagues home — ready to create the Habich family league fresh on ~Oct 5.

**Architecture:** Supabase Auth (OAuth PKCE via `@supabase/ssr`) sets a session cookie; `lib/auth/session.ts` is the only reader of it and `lib/auth/roles.ts` turns "user + league slug" into a membership check. The v1 `players` table becomes the membership table (`user_id`, `role`), so picks and adjustments keep working unchanged. All database access still goes through the `Repo` (service-role key, server only); the anon key is used only for Auth.

**Tech Stack:** Next.js 16.3 (App Router, `proxy.ts`), React 19, TypeScript strict, Tailwind 4, Supabase Postgres + Auth (`@supabase/supabase-js` 2, `@supabase/ssr` — new), zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-30-frc-fantasy-v2-design.md` — §4 (all), §3 (new pieces for SP1), §8.1, §8.2 row `0002`, §9, §11, §13. Plan index with the cross-plan contract: `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md`.

## Global Constraints

All constraints in `2026-09-30-frc-fantasy-v2.md` apply. SP1-specific ones, verbatim from the spec:

- **Providers:** Google and Discord via Supabase Auth OAuth (PKCE). Client IDs/secrets live in Supabase, not in our env.
- `next` must be a same-origin relative path starting with `/` and not `//` or `/\` (browsers normalize `/\` to protocol-relative); anything else becomes `/`.
- **Auth failure** (user cancels, provider error): callback redirects to `/?auth_error=1`, and the landing page shows "Sign-in didn't finish — try again."
- Profile display name from provider metadata (`full_name` → `name` → `user_name`, trimmed, cut to 40 chars; fallback `"Player"`).
- **Invite code:** 6 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L), stored uppercase, matched case-insensitively; unknown codes return a uniform 404. On a unique-violation the app retries with a fresh code (up to 3 times).
- **Caps:** ≤ 30 players per league (counting unlinked rows); joining a full league → 409 "League is full". **5 leagues created per user** → 409 "You've reached the 5-league limit".
- Name collision on join (case-insensitive): append ` 2`, ` 3`, …, trimming the base name first so the result stays ≤ 40 chars.
- **Remove member / leave / account deletion:** no picks, adjustments, or draft-order entries → delete the row; otherwise **unlink** (`user_id = null`, keep the name; shown as "Mom (left)"). Unlinked rows can't be re-linked.
- A league must always have ≥ 1 commissioner with a linked account; the last commissioner can't leave, be demoted, or be removed.
- **Delete account:** blocked while the user is the *only* commissioner of a league that has other linked members ("Make someone else commissioner first").
- **Delete league:** confirmation requires typing the league name.
- Members-only league and round pages render "Private league — ask the commissioner for an invite code" for non-members (no data).
- Unknown invite codes and non-member access to members-only data return uniform responses.
- Landing "Coming up": next 4 events from TBA `/events/{year}/simple` (`start_date ≥ today`, sorted; cache window 10 min). If TBA is unreachable the block is omitted.
- Footer copy: "Made by students on FRC Team 5181 · Data from The Blue Alliance".
- **E2E test sign-in:** `/api/test/login` works only when `E2E_AUTH_SECRET` is set, the request carries `Authorization: Bearer $E2E_AUTH_SECRET` (constant-time compare), **and** `process.env.VERCEL` is unset. 404 otherwise.
- Remove `CREATE_LEAGUE_PASSCODE`. Delete `lib/auth/rotate.ts`, `scripts/rotate-admin-token.ts`, and the fragment/`localStorage` token code in SP1.
- Before migration `0002`: delete every v1 league after Joey confirms the list. `tba_cache` is kept.

## Deviations from the spec (flagged for Joey)

1. **App tab bar on league pages.** Spec §4.6 says league pages "keep their existing top `TabBar`", but v1's league `TabBar` is itself a fixed *bottom* bar on phones. Two bottom bars won't fit, so the Me | Leagues bar is **hidden on `/l/*` pages**; there, the header logo (→ `/`, the Me tab) and the header avatar are the way home. Everywhere else signed-in pages get the Me | Leagues bar.
2. **Join/Me endpoints get concrete paths** (the spec names the screens, not the routes): `GET /api/invites/{code}`, `POST /api/invites/{code}/join`, `PATCH /api/l/{slug}/me` (rename self), `POST /api/l/{slug}/me/leave`, `PATCH /api/me/profile`, `DELETE /api/me`, `POST /api/l/{slug}/admin/invite` (reset code), `DELETE /api/l/{slug}/admin/league` (delete league, body `{ confirmName }`). Role changes and removals reuse v1's `PATCH`/`DELETE /api/l/{slug}/admin/players/{id}`.
3. **`POST /api/leagues` in SP1 takes `{ name, visibility }` only.** `format` and its options arrive with SP2 (spec §5). `/leagues/new?event={key}` creates the league, then adds the event as the first round with the existing `POST /admin/rounds`.
4. **`Repo.createPlayer(leagueId, name)` stays** (name-only, `user_id = null`) for tests and `scripts/seed-demo.ts`; no route calls it after SP1 (the v1 "add player" route is deleted).
5. **Me tab "Live now" in SP1 covers TBA rounds only**; season rounds (spec §4.6 second half of the bullet) are added by SP2.

## Review Focus

1. **Signed-out visitor opens `/l/{slug}/admin` or `/join/{code}`** → sees sign-in buttons whose `next` brings them back to the same page after OAuth, never a blank page. *Test in Task 9 (`AdminGateView`) and Task 15 (`JoinView`).*
2. **`next=//evil.com`, `next=/\evil.com`, `next=https://evil.com`, `next=%2F%2Fevil.com` on the callback** → redirect to `/`. *Test in Task 1 (`safeNext`) and Task 11 (callback route).*
3. **Last commissioner tries to leave, demote themselves, get removed, or delete their account** → 409 with a readable message and nothing changes. *Tests in Task 7, Task 10 and Task 12.*
4. **Two people join with the same display name ("Mom"), or a 40-char name collides** → second becomes "Mom 2", and a collided 40-char name is trimmed to fit (`…xxxxx 2`, 40 chars). *Test in Task 3 (`uniqueName`) and Task 10 (join route).*
5. **Non-member opens a members-only league's page, round page, or its read APIs** → private card / 403 with no league data (no names, no picks) in the response. *Test in Task 5 (`leagueAccess` / `requireLeagueView`) and Task 14 (league and round pages render only the card).*

## File Structure

```
supabase/migrations/0002_accounts.sql           profiles, players.user_id/role, gen_invite_code(), leagues.invite_code/visibility/created_by (Task 2)
proxy.ts                                        session refresh on every non-static request (Task 11)
lib/supabase/server.ts                          createServerSupabase(): @supabase/ssr server client (anon key, Auth only) (Task 1)
lib/supabase/browser.ts                         createBrowserSupabase(): browser client (Task 1)
lib/supabase/proxy.ts                           updateSession(request) used by proxy.ts (Task 11)
lib/auth/next.ts                                safeNext(): the open-redirect guard (Task 1)
lib/auth/session.ts                             SessionUser, getUser, requireUser — the only cookie reader (Task 5)
lib/auth/roles.ts                               LeagueRole, requireLeagueRole, requireLeagueView, leagueAccess (Tasks 5, 14)
lib/auth/profile.ts                             displayNameFromMetadata, ensureProfile (Task 11)
lib/auth/testLogin.ts                           testLoginAllowed (Task 12)
lib/auth/commissioner.ts                        trimmed to makeSlug, safeEqual, SLUG_RE (Task 9)
lib/leagues/inviteCode.ts                       generateInviteCode, normalizeInviteCode, INVITE_CODE_RE (Task 3)
lib/leagues/names.ts                            cleanName, NAME_MAX, uniqueName (Task 3)
lib/leagues/membership.ts                       removeMember (delete-or-unlink), assertKeepsCommissioner, MAX_PLAYERS, MAX_LEAGUES_PER_USER (Task 7)
lib/leagues/invites.ts  lib/leagues/inviteMessages.ts   leagueForCode, buildInvitePreview, BAD_CODE_MESSAGE (Tasks 10, 15)
lib/account/deleteAccount.ts                    deleteAccount(userId) (Task 12)
lib/views/me.ts                                 loadMePage, nextMatchLabel, matchLabel, seasonSummary (Task 17)
lib/views/landing.ts                            pickUpcoming, loadUpcomingEvents (Task 16)
lib/db/types.ts  lib/db/repo.ts  lib/db/supabaseRepo.ts   new row fields + Repo methods (Tasks 2, 4)
lib/api/http.ts                                 requireCommissioner removed; CONSTRAINT_MESSAGES += invite code (Task 5)
lib/api/types.ts                                AdminPlayer role/linked (Task 7), AdminLeague invite/visibility (Task 8), InvitePreview (Task 10), AdminState.me (Task 18)
lib/admin/client.ts                             token code removed; cookie-based adminFetch, createLeague (Task 9)
app/auth/callback/route.ts  app/auth/signout/route.ts   (Task 11)
app/api/leagues/route.ts                        POST create league (signed in, caps) (Task 8)
app/api/invites/[code]/route.ts                 GET invite preview (Task 10)
app/api/invites/[code]/join/route.ts            POST join (Task 10)
app/api/l/[slug]/me/route.ts                    PATCH rename self (Task 10)
app/api/l/[slug]/me/leave/route.ts              POST leave (Task 10)
app/api/l/[slug]/admin/invite/route.ts          POST reset invite code (Task 8)
app/api/l/[slug]/admin/league/route.ts          PATCH (+visibility, −homeTeamNumber), DELETE league (Task 8)
app/api/l/[slug]/admin/players/route.ts         DELETED (no name-only players) (Task 6)
app/api/l/[slug]/admin/players/[id]/route.ts    PATCH rename/role, DELETE remove-or-unlink (Task 7)
app/api/me/route.ts                             DELETE account (Task 12)
app/api/me/profile/route.ts                     PATCH display name / FRC team (Task 12)
app/api/test/login/route.ts                     E2E-only sign-in (Task 12)
app/layout.tsx                                  header: Sign in / avatar; AppTabBar (Task 13)
app/page.tsx                                    signed out → Landing (Task 16), signed in → MeHome (Task 17)
app/leagues/page.tsx  app/leagues/new/page.tsx  app/join/[code]/page.tsx  app/me/settings/page.tsx   (Task 15; /leagues rows upgraded in Task 17)
app/l/[slug]/layout.tsx, page.tsx, r/[roundId]/page.tsx   private card + server-known Admin tab (Task 14)
components/SignInButtons.tsx (Task 9)  components/AppTabBar.tsx  components/HeaderAccount.tsx (Task 13)  components/PrivateLeague.tsx (Task 14)
components/InviteCodeBox.tsx  JoinView.tsx  JoinButton.tsx  SettingsForm.tsx  SignInCard.tsx (Task 15)
components/landing/*.tsx (Task 16)  components/me/*.tsx (Task 17)
components/admin/MembersCard.tsx  components/admin/DangerZone.tsx   (Task 18)
components/admin/useAdmin.ts  AdminGate.tsx  TabBar.tsx  LeagueBar.tsx (Task 9)  CreateLeagueForm.tsx (Tasks 8, 15)
DELETED: components/CommissionerTag.tsx (Task 9)
scripts/delete-v1-leagues.ts                    list, then delete with --confirm (Task 2)
scripts/seed-demo.ts                            owner account instead of an admin link (Task 9)
scripts/db-smoke.ts                             accounts + RLS checks (Task 19)
tests/helpers/auth.ts                           setUser, fakeSession, signInAsMember (Task 5)
tests/helpers/api.ts  tests/helpers/memoryRepo.ts   updated (Tasks 4, 5)
tests/auth/*.test.ts  tests/leagues/*.test.ts  tests/api/*.test.ts  tests/views/me.test.ts  tests/views/landing.test.ts  tests/ui/*.test.ts
DELETED: lib/auth/rotate.ts, scripts/rotate-admin-token.ts, tests/auth/rotate.test.ts (Task 9)
```

**Why this shape:** everything that knows about cookies lives in `lib/supabase/` + `lib/auth/session.ts`, so route tests replace one module (`@/lib/auth/session`) with a fake and never touch Supabase Auth. Membership rules (caps, delete-or-unlink, last-commissioner) are pure-ish functions in `lib/leagues/` shared by the admin routes, the leave route, and account deletion, so the rule is written once.

## Task order and batches

| Batch | Tasks | Result |
|---|---|---|
| A — data + auth core | 1–5 | Migration, repo, pure helpers, session/roles; tests green on the new helpers |
| B — routes | 6–12 | Every v1 admin route on sessions; create/join/leave/members/account/auth routes |
| C — screens | 13–18 | Shell, private card, landing, Me, Leagues/Join/Settings, admin Members |
| D — ship | 19–21 | Scripts, docs + Joey's OAuth setup, merge + prod migration |

Stop for Joey's "go" between batches if he asks.

---
## Batch A — data + auth core

### Task 1: Supabase Auth clients and the `next` guard

**Files:**
- Modify: `package.json` (add `@supabase/ssr`)
- Modify: `.env.example`
- Create: `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `lib/auth/next.ts`
- Test: `tests/auth/next.test.ts`, `tests/auth/supabaseEnv.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createServerSupabase(): Promise<SupabaseClient>` (server components, route handlers), `createBrowserSupabase(): SupabaseClient` (client components), `supabaseAuthEnv(): { url: string; anonKey: string }`, `safeNext(raw: string | null | undefined): string`.

- [ ] **Step 1: Install `@supabase/ssr`**

Run: `npm install @supabase/ssr`
Expected: `package.json` gains `"@supabase/ssr"` under `dependencies`; `npm ls @supabase/ssr` prints one version.

- [ ] **Step 2: Write the failing tests**

`tests/auth/next.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth/next';

describe('safeNext (spec §4.1 open-redirect rule)', () => {
  it('keeps same-origin relative paths, including query and hash', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/l/habich-fam-abc234/admin')).toBe('/l/habich-fam-abc234/admin');
    expect(safeNext('/join/ABC234?x=1#top')).toBe('/join/ABC234?x=1#top');
  });

  it('turns everything else into /', () => {
    const bad = [
      null,
      undefined,
      '',
      'l/abc',
      '//evil.com',
      '//evil.com/l/abc',
      '/\\evil.com',
      '/\\/evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      '%2F%2Fevil.com',
      '/ok\nSet-Cookie: x=1',
      '/has\\backslash',
      `/${'a'.repeat(2001)}`,
    ];
    for (const raw of bad) expect(safeNext(raw), String(raw)).toBe('/');
  });
});
```

`tests/auth/supabaseEnv.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseAuthEnv } from '@/lib/supabase/server';

afterEach(() => vi.unstubAllEnvs());

describe('supabaseAuthEnv', () => {
  it('reads the public URL and anon key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    expect(supabaseAuthEnv()).toEqual({ url: 'https://abc.supabase.co', anonKey: 'anon-key' });
  });

  it('names the missing variable', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    expect(() => supabaseAuthEnv()).toThrow('NEXT_PUBLIC_SUPABASE_URL is not set');
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/auth/next.test.ts tests/auth/supabaseEnv.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/next"` and `"@/lib/supabase/server"`.

- [ ] **Step 4: Implement**

`lib/auth/next.ts`:

```ts
// The only place that decides where a sign-in may send someone afterwards (spec §4.1).
const BASE = 'http://same-origin.invalid';
const MAX_LENGTH = 2000;

/** A same-origin relative path, or "/" for anything that could leave the site. */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  // Browsers treat a backslash like a slash, and control characters can split headers.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
```

`lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Supabase *Auth* only. Database reads and writes still go through lib/db (service-role key).

export function supabaseAuthEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  return { url, anonKey };
}

/** A per-request Auth client that reads and writes the session cookies. */
export async function createServerSupabase() {
  const { url, anonKey } = supabaseAuthEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. proxy.ts refreshes the
          // session on every request, so nothing is lost.
        }
      },
    },
  });
}
```

`lib/supabase/browser.ts`:

```ts
'use client';

import { createBrowserClient } from '@supabase/ssr';

// NEXT_PUBLIC_* must be written out literally so Next.js inlines them into the browser bundle.
// Used only for signInWithOAuth; the browser never queries the database.
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
}
```

`.env.example` (replace the whole file):

```
# Copy to .env.local and fill in. Never commit .env.local.
TBA_API_KEY=
# Server-only database access (service role). Never prefix with NEXT_PUBLIC_.
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Supabase Auth in the browser. Public by design; RLS has no policies, so this key can't touch our tables.
# NEXT_PUBLIC_SUPABASE_URL must equal SUPABASE_URL.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Vercel cron (added in SP3; harmless to set now). 32+ random characters.
CRON_SECRET=
# Local only, never on Vercel: lets Playwright sign in through /api/test/login.
E2E_AUTH_SECRET=
```

(`CREATE_LEAGUE_PASSCODE` is gone from the example now; the code that reads it is removed in Task 8.)

- [ ] **Step 5: Run the tests to see them pass, then typecheck**

Run: `npx vitest run tests/auth/next.test.ts tests/auth/supabaseEnv.test.ts && npm run typecheck`
Expected: PASS (2 files), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example lib/supabase/server.ts lib/supabase/browser.ts lib/auth/next.ts tests/auth/next.test.ts tests/auth/supabaseEnv.test.ts
git commit -m "feat(auth): Supabase Auth clients and safeNext redirect guard"
```

---

### Task 2: Migration `0002_accounts.sql`, v1 league cleanup script, apply to the database

**Files:**
- Create: `supabase/migrations/0002_accounts.sql`
- Create: `scripts/delete-v1-leagues.ts`
- Modify: `lib/db/types.ts`, `lib/db/repo.ts` (`NewLeague`, `LeaguePatch`), `lib/db/supabaseRepo.ts` (mappers + `createLeague`/`updateLeague`), `tests/helpers/memoryRepo.ts` (defaults)
- Test: `tests/db/memoryRepo.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (contract): `LeagueRow` gains `inviteCode: string; visibility: 'link' | 'members'; createdBy: string | null; adminTokenHash: string | null`. `PlayerRow` gains `userId: string | null; role: LeagueRole`. `ProfileRow`. Types `Visibility = 'link' | 'members'` and `LeagueRole = 'commissioner' | 'player'` are declared in `lib/db/types.ts` (`lib/auth/roles.ts` re-exports `LeagueRole` in Task 5). `NewLeague` becomes `{ slug; name; defaultScoring; createdBy?: string | null; visibility?: Visibility; adminTokenHash?: string | null }`. `LeaguePatch` gains `visibility?: Visibility`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0002_accounts.sql`:

```sql
-- 0002_accounts.sql — v2 SP1: accounts & leagues (v2 spec §4, §8.2).
-- Run AFTER scripts/delete-v1-leagues.ts has removed the v1 demo/test leagues (spec §4.7).
-- Additive: v1 code keeps working while a deploy is in progress (every new NOT NULL column has a default).

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  avatar_url    text,
  frc_team      integer check (frc_team between 1 and 99999),
  created_at    timestamptz not null default now()
);
alter table profiles enable row level security;   -- on, with no policies, like every table (spec §8.1)

alter table players
  add column user_id  uuid references profiles(id) on delete set null,
  add column role     text not null default 'player' check (role in ('commissioner', 'player'));
create unique index players_league_user on players (league_id, user_id) where user_id is not null;
create index players_user_idx on players (user_id) where user_id is not null;

-- 6 characters, no 0/O/1/I/L (spec §4.4). The app retries on the rare collision.
create function gen_invite_code() returns text
language sql volatile
as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6)
$$;
revoke execute on function gen_invite_code() from public, anon, authenticated;
grant execute on function gen_invite_code() to service_role;

alter table leagues
  add column invite_code  text not null default gen_invite_code(),
  add column visibility   text not null default 'link' check (visibility in ('link', 'members')),
  add column created_by   uuid references profiles(id) on delete set null,
  alter column admin_token_hash drop not null;       -- dropped entirely in 0006_cleanup.sql
alter table leagues add constraint leagues_invite_code_key unique (invite_code);
create index leagues_created_by_idx on leagues (created_by);
```

- [ ] **Step 2: Write the cleanup script**

`scripts/delete-v1-leagues.ts`:

```ts
// v2 spec §4.7: v1 only ever held demo/test leagues, so they are deleted before migration 0002.
// Dry run (lists them):   npx tsx --env-file=.env.local scripts/delete-v1-leagues.ts
// Delete (after Joey OKs the list):
//                         npx tsx --env-file=.env.local scripts/delete-v1-leagues.ts --confirm <count>
// <count> must equal the number listed, so a league created in between is never deleted by surprise.
// Cascades to players, rounds, picks, adjustments and extra teams. tba_cache is left alone.
import { createSupabaseClient } from '@/lib/db/supabaseRepo';

async function main() {
  const db = createSupabaseClient();
  const { data, error } = await db.from('leagues').select('id, slug, name, created_at').order('created_at');
  if (error) throw new Error(error.message);
  const leagues = data ?? [];

  console.log(`${leagues.length} league(s):`);
  for (const l of leagues) console.log(`  ${l.slug}  "${l.name}"  created ${String(l.created_at).slice(0, 10)}`);

  const i = process.argv.indexOf('--confirm');
  if (i === -1) {
    console.log(`\nDry run. To delete all of these, re-run with --confirm ${leagues.length}`);
    return;
  }
  const expected = Number(process.argv[i + 1]);
  if (expected !== leagues.length) {
    throw new Error(`--confirm ${process.argv[i + 1]} doesn't match the ${leagues.length} league(s) listed. Nothing deleted.`);
  }
  for (const l of leagues) {
    const del = await db.from('leagues').delete().eq('id', l.id);
    if (del.error) throw new Error(`${l.slug}: ${del.error.message}`);
    console.log(`deleted ${l.slug}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Update the row types**

In `lib/db/types.ts`, add at the top (after the import) and change `LeagueRow` / `PlayerRow`:

```ts
export type Visibility = 'link' | 'members';
export type LeagueRole = 'commissioner' | 'player';

export type LeagueRow = {
  id: string;
  slug: string;
  name: string;
  /** v1 only; null for every v2 league. Column dropped in 0006. */
  adminTokenHash: string | null;
  homeTeamNumber: number;
  defaultScoring: ScoringConfig;
  inviteCode: string;
  visibility: Visibility;
  createdBy: string | null;
  createdAt: string;
};

export type PlayerRow = {
  id: string;
  leagueId: string;
  name: string;
  /** null = an unlinked former member ("Mom (left)"), or a name-only row made by tests/scripts. */
  userId: string | null;
  role: LeagueRole;
  createdAt: string;
};

export type ProfileRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  frcTeam: number | null;
  createdAt: string;
};
```

In `lib/db/repo.ts` change `NewLeague` and `LeaguePatch` (and import `Visibility`):

```ts
export type NewLeague = {
  slug: string;
  name: string;
  defaultScoring: ScoringConfig;
  createdBy?: string | null;
  visibility?: Visibility;
  /** v1 only. v2 leagues leave it out. */
  adminTokenHash?: string | null;
};
export type LeaguePatch = {
  name?: string;
  homeTeamNumber?: number;
  defaultScoring?: ScoringConfig;
  adminTokenHash?: string | null;
  visibility?: Visibility;
};
```

- [ ] **Step 4: Write the failing memory-repo tests**

Append to `tests/db/memoryRepo.test.ts` (inside the file's existing structure; `createMemoryRepo` and `defaultScoring` are already imported there):

```ts
describe('v2 league and player fields (SP1)', () => {
  it('gives every new league an invite code, link visibility, and no admin token', async () => {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    expect(league.inviteCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(league.visibility).toBe('link');
    expect(league.createdBy).toBeNull();
    expect(league.adminTokenHash).toBeNull();
  });

  it('keeps visibility and createdBy when given', async () => {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({
      slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring(),
      visibility: 'members', createdBy: '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b',
    });
    expect(league.visibility).toBe('members');
    expect(league.createdBy).toBe('3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b');
  });

  it('makes name-only players unlinked plain players', async () => {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    const mom = await repo.createPlayer(league.id, 'Mom');
    expect(mom.userId).toBeNull();
    expect(mom.role).toBe('player');
  });
});
```

Also change the existing test at `tests/db/memoryRepo.test.ts:9-12` and `:52` that pass `adminTokenHash: 'hash'` / `'h'`: leave them as they are (the field is still accepted).

- [ ] **Step 5: Run to see them fail**

Run: `npx vitest run tests/db/memoryRepo.test.ts`
Expected: FAIL — `expected undefined to match /^[2345…]{6}$/` (and typecheck errors on `userId`).

- [ ] **Step 6: Implement the defaults and mappers**

In `tests/helpers/memoryRepo.ts`, add `import { generateInviteCode } from '@/lib/leagues/inviteCode';` — **that module is created in Task 3**, so for this task inline a local helper instead and swap it in Task 3:

```ts
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  return code;
}
```

and replace `createLeague` / `createPlayer`:

```ts
    async createLeague(input) {
      if (leagues.some((l) => l.slug === input.slug)) throw new UniqueViolation('leagues_slug_key');
      const row: LeagueRow = {
        id: randomUUID(),
        slug: input.slug,
        name: input.name,
        defaultScoring: copy(input.defaultScoring),
        adminTokenHash: input.adminTokenHash ?? null,
        homeTeamNumber: 5181,
        inviteCode: newInviteCode(),
        visibility: input.visibility ?? 'link',
        createdBy: input.createdBy ?? null,
        createdAt: stamp(),
      };
      leagues.push(row);
      return copy(row);
    },
```

```ts
    async createPlayer(leagueId, name) {
      if (players.some((p) => p.leagueId === leagueId && p.name.toLowerCase() === name.toLowerCase())) {
        throw new UniqueViolation('players_league_name_ci');
      }
      const row: PlayerRow = { id: randomUUID(), leagueId, name, userId: null, role: 'player', createdAt: stamp() };
      players.push(row);
      return copy(row);
    },
```

In `lib/db/supabaseRepo.ts` update the two mappers and the league writes:

```ts
const toLeague = (r: Raw): LeagueRow => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  adminTokenHash: r.admin_token_hash ?? null,
  homeTeamNumber: r.home_team_number,
  defaultScoring: r.default_scoring,
  inviteCode: r.invite_code,
  visibility: r.visibility,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
});
const toPlayer = (r: Raw): PlayerRow => ({
  id: r.id,
  leagueId: r.league_id,
  name: r.name,
  userId: r.user_id ?? null,
  role: r.role,
  createdAt: r.created_at,
});
```

```ts
    async createLeague(input) {
      const rows = await run(
        db
          .from('leagues')
          .insert(
            defined({
              slug: input.slug,
              name: input.name,
              default_scoring: input.defaultScoring,
              admin_token_hash: input.adminTokenHash ?? null,
              visibility: input.visibility,
              created_by: input.createdBy ?? null,
              // invite_code comes from the column default, gen_invite_code()
            }),
          )
          .select(),
      );
      return first(rows, toLeague, 'league');
    },
```

and in `updateLeague` add `visibility: patch.visibility,` to the `defined({...})` object.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/db/memoryRepo.test.ts && npm run typecheck && npm test`
Expected: PASS; typecheck clean; full suite still 490+ passing (v1 routes still use `requireCommissioner`, which reads `adminTokenHash` — add a `!league.adminTokenHash ||` guard in `requireCommissioner` if TypeScript flags the nullable: `if (!league || !league.adminTokenHash || !verifyToken(token, league.adminTokenHash)) throw new HttpError(403, 'Forbidden');`).

- [ ] **Step 8: Joey checkpoint — delete the v1 leagues, apply 0002**

The project in `.env.local` is the same Supabase project production uses (CLAUDE.md "Local dev works against the real Supabase project"). Confirm with `grep SUPABASE_URL .env.local` against Vercel → Settings → Environment Variables; if they differ, repeat this step against production in Task 21.

1. Run `npx tsx --env-file=.env.local scripts/delete-v1-leagues.ts` and **show Joey the list** (expected: `demo-fam-*` ×2, `playwright-test-*`, `testleague-o3alja`, `niche-*`). Stop until Joey says the list is OK.
2. Run `npx tsx --env-file=.env.local scripts/delete-v1-leagues.ts --confirm <count>`.
3. Joey pastes `supabase/migrations/0002_accounts.sql` into Supabase → SQL Editor → Run. Expected: "Success. No rows returned".
4. Check: `select column_name from information_schema.columns where table_name = 'leagues' and column_name in ('invite_code','visibility','created_by');` → 3 rows.

The live v1 site keeps working (its league creation still inserts without `invite_code`; the default fills it).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0002_accounts.sql scripts/delete-v1-leagues.ts lib/db/types.ts lib/db/repo.ts lib/db/supabaseRepo.ts lib/api/http.ts tests/helpers/memoryRepo.ts tests/db/memoryRepo.test.ts
git commit -m "feat(db): migration 0002 accounts schema + v1 league cleanup script"
```

---

### Task 3: Invite codes and member names (pure)

**Files:**
- Create: `lib/leagues/inviteCode.ts`, `lib/leagues/names.ts`
- Modify: `tests/helpers/memoryRepo.ts` (use `generateInviteCode`)
- Test: `tests/leagues/inviteCode.test.ts`, `tests/leagues/names.test.ts`

**Interfaces:**
- Produces: `INVITE_ALPHABET`, `INVITE_CODE_RE`, `generateInviteCode(randomIndex?: (n: number) => number): string`, `normalizeInviteCode(raw: string): string | null`; `NAME_MAX = 40`, `cleanName(raw: unknown): string | null`, `uniqueName(base: string, taken: string[]): string`, `nameSchema` (zod).

- [ ] **Step 1: Write the failing tests**

`tests/leagues/inviteCode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateInviteCode, INVITE_CODE_RE, normalizeInviteCode } from '@/lib/leagues/inviteCode';

describe('generateInviteCode (spec §4.4)', () => {
  it('makes 6 characters from the no-lookalikes alphabet', () => {
    for (let i = 0; i < 200; i++) expect(generateInviteCode()).toMatch(INVITE_CODE_RE);
  });
  it('never uses 0, O, 1, I or L', () => {
    const all = Array.from({ length: 500 }, () => generateInviteCode()).join('');
    expect(all).not.toMatch(/[0O1IL]/);
  });
  it('uses the random source it is given', () => {
    expect(generateInviteCode(() => 0)).toBe('222222');
    expect(generateInviteCode((n) => n - 1)).toBe('ZZZZZZ');
  });
});

describe('normalizeInviteCode', () => {
  it('trims and uppercases a valid code', () => {
    expect(normalizeInviteCode(' abc234 ')).toBe('ABC234');
  });
  it('rejects anything that is not a possible code', () => {
    for (const raw of ['', 'ABC23', 'ABC2345', 'ABC10O', 'ABC-23', 'ÅBC234']) {
      expect(normalizeInviteCode(raw), raw).toBeNull();
    }
  });
});
```

`tests/leagues/names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cleanName, NAME_MAX, uniqueName } from '@/lib/leagues/names';

describe('cleanName (spec §4.8)', () => {
  it('trims and keeps 1–40 characters', () => {
    expect(cleanName('  Mom ')).toBe('Mom');
    expect(cleanName('x'.repeat(40))).toBe('x'.repeat(40));
  });
  it('rejects empty, too long, control characters, and non-strings', () => {
    for (const raw of ['', '   ', 'x'.repeat(41), 'Mo\u0000m', 'Tab\there', 42, null]) {
      expect(cleanName(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe('uniqueName (spec §4.3)', () => {
  it('keeps a free name', () => {
    expect(uniqueName('Mom', ['Dad'])).toBe('Mom');
  });
  it('appends 2, 3, … case-insensitively', () => {
    expect(uniqueName('Mom', ['mom'])).toBe('Mom 2');
    expect(uniqueName('Mom', ['MOM', 'Mom 2'])).toBe('Mom 3');
  });
  it('trims the base so a suffixed 40-character name still fits', () => {
    const base = 'A'.repeat(NAME_MAX);
    const out = uniqueName(base, [base]);
    expect(out).toBe(`${'A'.repeat(NAME_MAX - 2)} 2`);
    expect(out).toHaveLength(NAME_MAX);
  });
  it('drops a trailing space left by trimming', () => {
    const base = `${'A'.repeat(37)} BC`; // 40 chars; cut to 38 ends with a space
    expect(uniqueName(base, [base])).toBe(`${'A'.repeat(37)} 2`);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/leagues/`
Expected: FAIL — cannot resolve `@/lib/leagues/inviteCode` / `names`.

- [ ] **Step 3: Implement**

`lib/leagues/inviteCode.ts`:

```ts
// Spec §4.4: 6 characters, no 0/O/1/I/L, stored uppercase, matched case-insensitively.
// No node:* imports: the invite-code box on the landing page imports normalizeInviteCode in the browser.
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** Web Crypto works in Node 20+ and browsers. The modulo bias over 2^32 is negligible for 31 symbols. */
function secureIndex(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

export function generateInviteCode(randomIndex: (n: number) => number = secureIndex): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[randomIndex(INVITE_ALPHABET.length)];
  return code;
}

/** "abc234 " → "ABC234"; anything that can't be a code → null (callers answer a uniform 404). */
export function normalizeInviteCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}
```

`lib/leagues/names.ts`:

```ts
import { z } from 'zod';

export const NAME_MAX = 40;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Display and player names (spec §4.8): 1–40 chars after trimming, no control characters. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > NAME_MAX || CONTROL_RE.test(name)) return null;
  return name;
}

/** zod version of cleanName for request bodies. */
export const nameSchema = z
  .string('Name is required')
  .trim()
  .min(1, 'Name is required')
  .max(NAME_MAX, `Names must be ${NAME_MAX} characters or fewer`)
  .refine((s) => !CONTROL_RE.test(s), 'Names can’t contain control characters');

/** "Mom" → "Mom 2" → "Mom 3" … when taken (case-insensitive), always ≤ 40 chars (spec §4.3). */
export function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${base.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
```

In `tests/helpers/memoryRepo.ts`, delete the local `INVITE_ALPHABET`/`newInviteCode` from Task 2, add `import { generateInviteCode } from '@/lib/leagues/inviteCode';`, and use `inviteCode: generateInviteCode(),` in `createLeague`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/leagues/ tests/db/memoryRepo.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/leagues/inviteCode.ts lib/leagues/names.ts tests/leagues/ tests/helpers/memoryRepo.ts
git commit -m "feat(leagues): invite codes and collision-safe member names"
```

---

### Task 4: Repo methods for profiles, members, and invite codes

**Files:**
- Modify: `lib/db/repo.ts`, `lib/db/supabaseRepo.ts`, `tests/helpers/memoryRepo.ts`, `lib/api/http.ts` (`CONSTRAINT_MESSAGES`)
- Test: `tests/db/memoryRepo.test.ts`

**Interfaces:**
- Consumes: `generateInviteCode` (Task 3), row types (Task 2).
- Produces (contract, exact):
  - `getProfile(id: string): Promise<ProfileRow | null>`
  - `createProfile(input: NewProfile): Promise<ProfileRow>` — `NewProfile = { id: string; displayName: string; avatarUrl: string | null }`; if the profile already exists, returns the existing row unchanged.
  - `updateProfile(id: string, patch: ProfilePatch): Promise<ProfileRow>` — `ProfilePatch = { displayName?: string; frcTeam?: number | null }`
  - `deleteUser(id: string): Promise<void>` — deletes the auth user; the profile cascades; `players.user_id` and `leagues.created_by` become null.
  - `getLeagueByInviteCode(code: string): Promise<LeagueRow | null>` (code already normalized)
  - `resetInviteCode(leagueId: string): Promise<LeagueRow>` (retries 3× on collision)
  - `countLeaguesCreatedBy(userId: string): Promise<number>`
  - `listLeaguesForUser(userId: string): Promise<MemberLeague[]>` — `MemberLeague = { league: LeagueRow; player: PlayerRow }`, oldest league first
  - `createMember(input: NewMember): Promise<PlayerRow>` — `NewMember = { leagueId: string; userId: string; name: string; role: LeagueRole }`
  - `getMemberByUser(leagueId: string, userId: string): Promise<PlayerRow | null>`
  - `updatePlayer(id: string, patch: PlayerPatch): Promise<PlayerRow>` — `PlayerPatch = { name?: string; role?: LeagueRole; userId?: null }`
  - `CONSTRAINT_MESSAGES` gains `players_league_user: "You're already in this league"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/memoryRepo.test.ts`:

```ts
describe('profiles and members (SP1)', () => {
  const USER = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b';
  const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  async function setup() {
    const repo = createMemoryRepo();
    const profile = await repo.createProfile({ id: USER, displayName: 'Joey', avatarUrl: null });
    const league = await repo.createLeague({
      slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring(), createdBy: USER,
    });
    return { repo, profile, league };
  }

  it('creates a profile once and returns the existing one on a repeat', async () => {
    const { repo } = await setup();
    const again = await repo.createProfile({ id: USER, displayName: 'Changed', avatarUrl: 'x' });
    expect(again.displayName).toBe('Joey');
    expect((await repo.getProfile(USER))!.frcTeam).toBeNull();
    expect(await repo.getProfile(OTHER)).toBeNull();
  });

  it('updates display name and FRC team', async () => {
    const { repo } = await setup();
    const saved = await repo.updateProfile(USER, { displayName: 'Joey H', frcTeam: 5181 });
    expect(saved).toMatchObject({ displayName: 'Joey H', frcTeam: 5181 });
    expect((await repo.updateProfile(USER, { frcTeam: null })).frcTeam).toBeNull();
  });

  it('creates a member, finds it by user, and lists the user’s leagues', async () => {
    const { repo, league } = await setup();
    const me = await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'commissioner' });
    expect(me).toMatchObject({ userId: USER, role: 'commissioner', name: 'Joey' });
    expect((await repo.getMemberByUser(league.id, USER))!.id).toBe(me.id);
    expect(await repo.getMemberByUser(league.id, OTHER)).toBeNull();
    const mine = await repo.listLeaguesForUser(USER);
    expect(mine.map((m) => [m.league.slug, m.player.id])).toEqual([['fam-abc234', me.id]]);
  });

  it('refuses a second membership for the same user in one league', async () => {
    const { repo, league } = await setup();
    await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'player' });
    await expect(
      repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey 2', role: 'player' }),
    ).rejects.toMatchObject({ constraint: 'players_league_user' });
  });

  it('updates a player’s name, role, and unlinks them', async () => {
    const { repo, league } = await setup();
    const me = await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'player' });
    expect((await repo.updatePlayer(me.id, { role: 'commissioner' })).role).toBe('commissioner');
    expect((await repo.updatePlayer(me.id, { name: 'J' })).name).toBe('J');
    const unlinked = await repo.updatePlayer(me.id, { userId: null });
    expect(unlinked.userId).toBeNull();
    expect(await repo.listLeaguesForUser(USER)).toEqual([]);
  });

  it('finds a league by invite code and resets it to a different code', async () => {
    const { repo, league } = await setup();
    expect((await repo.getLeagueByInviteCode(league.inviteCode))!.id).toBe(league.id);
    const reset = await repo.resetInviteCode(league.id);
    expect(reset.inviteCode).not.toBe(league.inviteCode);
    expect(await repo.getLeagueByInviteCode(league.inviteCode)).toBeNull();
  });

  it('counts leagues created by a user', async () => {
    const { repo } = await setup();
    await repo.createLeague({ slug: 'two-abc234', name: 'Two', defaultScoring: defaultScoring(), createdBy: USER });
    expect(await repo.countLeaguesCreatedBy(USER)).toBe(2);
    expect(await repo.countLeaguesCreatedBy(OTHER)).toBe(0);
  });

  it('deleting a user removes the profile and unlinks their rows', async () => {
    const { repo, league } = await setup();
    const me = await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'commissioner' });
    await repo.deleteUser(USER);
    expect(await repo.getProfile(USER)).toBeNull();
    expect((await repo.listPlayers(league.id)).find((p) => p.id === me.id)!.userId).toBeNull();
    expect((await repo.getLeagueBySlug('fam-abc234'))!.createdBy).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/db/memoryRepo.test.ts`
Expected: FAIL — `repo.createProfile is not a function`.

- [ ] **Step 3: Add the types and interface methods**

In `lib/db/repo.ts` add (import `LeagueRole`, `ProfileRow` from `@/lib/db/types`):

```ts
export type NewProfile = { id: string; displayName: string; avatarUrl: string | null };
export type ProfilePatch = { displayName?: string; frcTeam?: number | null };
export type NewMember = { leagueId: string; userId: string; name: string; role: LeagueRole };
export type PlayerPatch = { name?: string; role?: LeagueRole; userId?: null };
export type MemberLeague = { league: LeagueRow; player: PlayerRow };
```

and inside `interface Repo`, after the league methods and after the player methods respectively:

```ts
  getLeagueByInviteCode(code: string): Promise<LeagueRow | null>;
  /** New random code; retries up to 3 times if it collides. */
  resetInviteCode(leagueId: string): Promise<LeagueRow>;
  countLeaguesCreatedBy(userId: string): Promise<number>;
  /** Oldest league first. */
  listLeaguesForUser(userId: string): Promise<MemberLeague[]>;

  createMember(input: NewMember): Promise<PlayerRow>;
  getMemberByUser(leagueId: string, userId: string): Promise<PlayerRow | null>;
  updatePlayer(id: string, patch: PlayerPatch): Promise<PlayerRow>;

  getProfile(id: string): Promise<ProfileRow | null>;
  /** Returns the existing row unchanged if the profile already exists. */
  createProfile(input: NewProfile): Promise<ProfileRow>;
  updateProfile(id: string, patch: ProfilePatch): Promise<ProfileRow>;
  /** Deletes the Supabase Auth user. The profile cascades; players.user_id and leagues.created_by become null. */
  deleteUser(id: string): Promise<void>;
```

In `lib/api/http.ts` add to `CONSTRAINT_MESSAGES`: `players_league_user: "You're already in this league",`.

- [ ] **Step 4: Implement in the memory repo**

In `tests/helpers/memoryRepo.ts` add `ProfileRow` to the type import, `let profiles: ProfileRow[] = [];` next to the other arrays, and these methods in the returned object:

```ts
    async getLeagueByInviteCode(code) {
      return copy(leagues.find((l) => l.inviteCode === code) ?? null);
    },
    async resetInviteCode(leagueId) {
      const row = find(leagues, leagueId, 'league');
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = generateInviteCode();
        if (code !== row.inviteCode && !leagues.some((l) => l.inviteCode === code)) {
          row.inviteCode = code;
          return copy(row);
        }
      }
      throw new UniqueViolation('leagues_invite_code_key');
    },
    async countLeaguesCreatedBy(userId) {
      return leagues.filter((l) => l.createdBy === userId).length;
    },
    async listLeaguesForUser(userId) {
      return copy(
        players
          .filter((p) => p.userId === userId)
          .map((player) => ({ league: find(leagues, player.leagueId, 'league'), player }))
          .sort((a, b) => a.league.createdAt.localeCompare(b.league.createdAt)),
      );
    },

    async createMember(input) {
      if (players.some((p) => p.leagueId === input.leagueId && p.userId === input.userId)) {
        throw new UniqueViolation('players_league_user');
      }
      if (players.some((p) => p.leagueId === input.leagueId && p.name.toLowerCase() === input.name.toLowerCase())) {
        throw new UniqueViolation('players_league_name_ci');
      }
      const row: PlayerRow = { id: randomUUID(), createdAt: stamp(), ...input };
      players.push(row);
      return copy(row);
    },
    async getMemberByUser(leagueId, userId) {
      return copy(players.find((p) => p.leagueId === leagueId && p.userId === userId) ?? null);
    },
    async updatePlayer(id, patch) {
      const row = find(players, id, 'player');
      if (patch.name !== undefined) {
        const clash = players.some(
          (p) => p.id !== id && p.leagueId === row.leagueId && p.name.toLowerCase() === patch.name!.toLowerCase(),
        );
        if (clash) throw new UniqueViolation('players_league_name_ci');
      }
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },

    async getProfile(id) {
      return copy(profiles.find((p) => p.id === id) ?? null);
    },
    async createProfile(input) {
      const existing = profiles.find((p) => p.id === input.id);
      if (existing) return copy(existing);
      const row: ProfileRow = { ...input, frcTeam: null, createdAt: stamp() };
      profiles.push(row);
      return copy(row);
    },
    async updateProfile(id, patch) {
      const row = find(profiles, id, 'profile');
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },
    async deleteUser(id) {
      profiles = profiles.filter((p) => p.id !== id);
      for (const p of players) if (p.userId === id) p.userId = null;
      for (const l of leagues) if (l.createdBy === id) l.createdBy = null;
    },
```

Note `defined()` drops only `undefined`, so `{ userId: null }` and `{ frcTeam: null }` are applied.

- [ ] **Step 5: Implement in the Supabase repo**

In `lib/db/supabaseRepo.ts` add `ProfileRow` to the type import, `import { generateInviteCode } from '@/lib/leagues/inviteCode';`, a mapper, and the methods:

```ts
const toProfile = (r: Raw): ProfileRow => ({
  id: r.id,
  displayName: r.display_name,
  avatarUrl: r.avatar_url ?? null,
  frcTeam: r.frc_team ?? null,
  createdAt: r.created_at,
});
```

```ts
    async getLeagueByInviteCode(code) {
      const rows = await run(db.from('leagues').select().eq('invite_code', code).limit(1));
      return rows[0] ? toLeague(rows[0]) : null;
    },
    async resetInviteCode(leagueId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const rows = await run(
            db.from('leagues').update({ invite_code: generateInviteCode() }).eq('id', leagueId).select(),
          );
          return first(rows, toLeague, 'league');
        } catch (err) {
          if (err instanceof UniqueViolation && err.constraint === 'leagues_invite_code_key') continue;
          throw err;
        }
      }
      throw new UniqueViolation('leagues_invite_code_key');
    },
    async countLeaguesCreatedBy(userId) {
      const rows = await run(db.from('leagues').select('id').eq('created_by', userId));
      return rows.length;
    },
    async listLeaguesForUser(userId) {
      const rows = await run(db.from('players').select('*, leagues(*)').eq('user_id', userId));
      return rows
        .map((r) => ({ league: toLeague(r.leagues), player: toPlayer(r) }))
        .sort((a, b) => a.league.createdAt.localeCompare(b.league.createdAt));
    },

    async createMember(input) {
      const rows = await run(
        db
          .from('players')
          .insert({ league_id: input.leagueId, user_id: input.userId, name: input.name, role: input.role })
          .select(),
      );
      return first(rows, toPlayer, 'player');
    },
    async getMemberByUser(leagueId, userId) {
      const rows = await run(
        db.from('players').select().eq('league_id', leagueId).eq('user_id', userId).limit(1),
      );
      return rows[0] ? toPlayer(rows[0]) : null;
    },
    async updatePlayer(id, patch) {
      const rows = await run(
        db
          .from('players')
          .update(defined({ name: patch.name, role: patch.role, user_id: patch.userId }))
          .eq('id', id)
          .select(),
      );
      return first(rows, toPlayer, 'player');
    },

    async getProfile(id) {
      const rows = await run(db.from('profiles').select().eq('id', id).limit(1));
      return rows[0] ? toProfile(rows[0]) : null;
    },
    async createProfile(input) {
      try {
        const rows = await run(
          db
            .from('profiles')
            .insert({ id: input.id, display_name: input.displayName, avatar_url: input.avatarUrl })
            .select(),
        );
        return first(rows, toProfile, 'profile');
      } catch (err) {
        // Two tabs finishing sign-in at once: the second insert loses, and that's fine.
        if (err instanceof UniqueViolation && err.constraint === 'profiles_pkey') {
          return first(await run(db.from('profiles').select().eq('id', input.id).limit(1)), toProfile, 'profile');
        }
        throw err;
      }
    },
    async updateProfile(id, patch) {
      const rows = await run(
        db
          .from('profiles')
          .update(defined({ display_name: patch.displayName, frc_team: patch.frcTeam }))
          .eq('id', id)
          .select(),
      );
      return first(rows, toProfile, 'profile');
    },
    async deleteUser(id) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) throw new Error(`Couldn't delete the account: ${error.message}`);
    },
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/db/memoryRepo.test.ts && npm run typecheck && npm test`
Expected: PASS; typecheck clean; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add lib/db/repo.ts lib/db/supabaseRepo.ts lib/api/http.ts tests/helpers/memoryRepo.ts tests/db/memoryRepo.test.ts
git commit -m "feat(db): repo methods for profiles, members, and invite codes"
```

---
### Task 5: Session and role checks

**Files:**
- Create: `lib/auth/session.ts`, `lib/auth/roles.ts`, `tests/helpers/auth.ts`
- Test: `tests/auth/session.test.ts`, `tests/auth/roles.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase` (Task 1); `getMemberByUser`, `getLeagueBySlug`, `createProfile`, `createMember` (Task 4); `HttpError` (`lib/api/http.ts`).
- Produces (contract, exact): `SessionUser = { id: string; email: string | null }`; `getUser(): Promise<SessionUser | null>`; `requireUser(): Promise<SessionUser>` (401 `'Sign in first'`); `LeagueRole` (re-export); `requireLeagueRole(slug, role): Promise<{ user; league; player }>` (401 / 404 `'League not found'` / 403 `'Forbidden'`); `requireLeagueView(slug): Promise<{ user: SessionUser | null; league; player: PlayerRow | null }>` (404 / 403 `'This league is private'`). Extra: `LeagueAccess = { user: SessionUser | null; league: LeagueRow; player: PlayerRow | null; canView: boolean; isCommissioner: boolean }` and `leagueAccess(slug): Promise<LeagueAccess | null>` for pages (Task 14).
- Test helpers: `setUser(user | null)`, `fakeSession` (module shape of `@/lib/auth/session`), `makeUser(repo, displayName?)`, `signInAsMember(repo, league, name?, role?)`.

- [ ] **Step 1: Write the test helper**

`tests/helpers/auth.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { HttpError } from '@/lib/api/http';
import type { SessionUser } from '@/lib/auth/session';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRole, LeagueRow, PlayerRow } from '@/lib/db/types';

// Route tests swap the real session module for this one:
//   vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
// and choose who is "signed in" with setUser().

let current: SessionUser | null = null;

export function setUser(user: SessionUser | null): void {
  current = user;
}

export const fakeSession = {
  getUser: async (): Promise<SessionUser | null> => current,
  requireUser: async (): Promise<SessionUser> => {
    if (!current) throw new HttpError(401, 'Sign in first');
    return current;
  },
};

/** A user with a profile, not signed in yet. */
export async function makeUser(repo: Repo, displayName = 'Pat'): Promise<SessionUser> {
  const id = randomUUID();
  await repo.createProfile({ id, displayName, avatarUrl: null });
  return { id, email: `${displayName.toLowerCase().replace(/\W+/g, '')}@example.com` };
}

/** Makes a user, adds them to the league, and signs them in. */
export async function signInAsMember(
  repo: Repo,
  league: LeagueRow,
  name = 'Pat',
  role: LeagueRole = 'player',
): Promise<{ user: SessionUser; player: PlayerRow }> {
  const user = await makeUser(repo, name);
  const player = await repo.createMember({ leagueId: league.id, userId: user.id, name, role });
  setUser(user);
  return { user, player };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/auth/session.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ claims: undefined as unknown, error: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getClaims: async () => ({ data: h.claims === undefined ? null : { claims: h.claims }, error: h.error }) },
  }),
}));

import { getUser, requireUser } from '@/lib/auth/session';

describe('getUser', () => {
  it('returns the signed-in user from the verified claims', async () => {
    h.claims = { sub: 'u-1', email: 'joey@example.com' };
    h.error = null;
    expect(await getUser()).toEqual({ id: 'u-1', email: 'joey@example.com' });
  });
  it('is null with no session, a bad token, or no subject', async () => {
    for (const [claims, error] of [
      [undefined, null],
      [{ sub: 'u-1' }, { message: 'invalid JWT' }],
      [{ email: 'x@example.com' }, null],
    ] as const) {
      h.claims = claims;
      h.error = error;
      expect(await getUser()).toBeNull();
    }
  });
  it('treats a missing email as null', async () => {
    h.claims = { sub: 'u-2' };
    h.error = null;
    expect(await getUser()).toEqual({ id: 'u-2', email: null });
  });
});

describe('requireUser', () => {
  it('answers 401 when signed out', async () => {
    h.claims = undefined;
    await expect(requireUser()).rejects.toMatchObject({ status: 401, message: 'Sign in first' });
  });
});
```

`tests/auth/roles.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { leagueAccess, requireLeagueRole, requireLeagueView } from '@/lib/auth/roles';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser, signInAsMember } from '../helpers/auth';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  setUser(null);
  league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
});

describe('requireLeagueRole', () => {
  it('answers 401 signed out, before looking at the league', async () => {
    await expect(requireLeagueRole('no-such-league', 'player')).rejects.toMatchObject({ status: 401 });
  });
  it('answers 404 for an unknown league', async () => {
    setUser(await makeUser(repo));
    await expect(requireLeagueRole('no-such-league', 'player')).rejects.toMatchObject({
      status: 404, message: 'League not found',
    });
  });
  it('answers 403 for a non-member and for a player asking for commissioner', async () => {
    setUser(await makeUser(repo, 'Stranger'));
    await expect(requireLeagueRole(league.slug, 'player')).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
    await signInAsMember(repo, league, 'Mom', 'player');
    await expect(requireLeagueRole(league.slug, 'commissioner')).rejects.toMatchObject({ status: 403 });
  });
  it('admits members, and commissioners for player-level checks', async () => {
    const { player } = await signInAsMember(repo, league, 'Joey', 'commissioner');
    expect((await requireLeagueRole(league.slug, 'commissioner')).player.id).toBe(player.id);
    expect((await requireLeagueRole(league.slug, 'player')).league.id).toBe(league.id);
  });
  it("doesn't let league A's commissioner into league B", async () => {
    await signInAsMember(repo, league, 'Joey', 'commissioner');
    await repo.createLeague({ slug: 'other-bbbbbb', name: 'Other', defaultScoring: defaultScoring() });
    await expect(requireLeagueRole('other-bbbbbb', 'commissioner')).rejects.toMatchObject({ status: 403 });
  });
});

describe('leagueAccess / requireLeagueView (spec §4.5)', () => {
  it('lets anyone view a link league, signed in or not', async () => {
    const a = await leagueAccess(league.slug);
    expect(a).toMatchObject({ canView: true, isCommissioner: false, user: null, player: null });
    await expect(requireLeagueView(league.slug)).resolves.toMatchObject({ player: null });
  });
  it('hides a members-only league from non-members with a uniform 403', async () => {
    await repo.updateLeague(league.id, { visibility: 'members' });
    expect((await leagueAccess(league.slug))!.canView).toBe(false);
    await expect(requireLeagueView(league.slug)).rejects.toMatchObject({ status: 403, message: 'This league is private' });
    setUser(await makeUser(repo, 'Stranger'));
    await expect(requireLeagueView(league.slug)).rejects.toMatchObject({ status: 403 });
  });
  it('shows a members-only league to its members and flags commissioners', async () => {
    await repo.updateLeague(league.id, { visibility: 'members' });
    await signInAsMember(repo, league, 'Joey', 'commissioner');
    expect(await leagueAccess(league.slug)).toMatchObject({ canView: true, isCommissioner: true });
  });
  it('is null / 404 for an unknown league', async () => {
    expect(await leagueAccess('nope-abc234')).toBeNull();
    await expect(requireLeagueView('nope-abc234')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run tests/auth/session.test.ts tests/auth/roles.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/session` / `@/lib/auth/roles`.

- [ ] **Step 4: Implement**

`lib/auth/session.ts`:

```ts
import { HttpError } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// The ONLY module that reads the auth cookie (spec §3, §8.1). Tests replace it with tests/helpers/auth.ts.

export type SessionUser = { id: string; email: string | null };

/** The signed-in user, or null. getClaims() verifies the session JWT; an invalid one counts as signed out. */
export async function getUser(): Promise<SessionUser | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: unknown; email?: unknown } | undefined;
  if (error || !claims || typeof claims.sub !== 'string' || claims.sub === '') return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new HttpError(401, 'Sign in first');
  return user;
}
```

`lib/auth/roles.ts`:

```ts
import { HttpError } from '@/lib/api/http';
import { getUser, requireUser, type SessionUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import type { LeagueRole, LeagueRow, PlayerRow } from '@/lib/db/types';

export type { LeagueRole } from '@/lib/db/types';

/**
 * The membership check for every mutating league route (spec §4.5).
 * 401 signed out → 404 unknown league → 403 not a member / not a commissioner.
 * 'player' also admits commissioners.
 */
export async function requireLeagueRole(
  slug: string,
  role: LeagueRole,
): Promise<{ user: SessionUser; league: LeagueRow; player: PlayerRow }> {
  const user = await requireUser();
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) throw new HttpError(404, 'League not found');
  const player = await repo.getMemberByUser(league.id, user.id);
  if (!player || (role === 'commissioner' && player.role !== 'commissioner')) {
    throw new HttpError(403, 'Forbidden');
  }
  return { user, league, player };
}

export type LeagueAccess = {
  user: SessionUser | null;
  league: LeagueRow;
  player: PlayerRow | null;
  /** link leagues: everyone. members leagues: members only. */
  canView: boolean;
  isCommissioner: boolean;
};

/** For pages: who is looking and what they may see. null = no such league. */
export async function leagueAccess(slug: string): Promise<LeagueAccess | null> {
  const repo = getRepo();
  const [user, league] = await Promise.all([getUser(), repo.getLeagueBySlug(slug)]);
  if (!league) return null;
  const player = user ? await repo.getMemberByUser(league.id, user.id) : null;
  return {
    user,
    league,
    player,
    canView: league.visibility === 'link' || player !== null,
    isCommissioner: player?.role === 'commissioner',
  };
}

/** For read APIs (pool, draft state): 404 unknown, 403 for non-members of members-only leagues. */
export async function requireLeagueView(
  slug: string,
): Promise<{ user: SessionUser | null; league: LeagueRow; player: PlayerRow | null }> {
  const access = await leagueAccess(slug);
  if (!access) throw new HttpError(404, 'League not found');
  if (!access.canView) throw new HttpError(403, 'This league is private');
  return { user: access.user, league: access.league, player: access.player };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/auth/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/session.ts lib/auth/roles.ts tests/helpers/auth.ts tests/auth/session.test.ts tests/auth/roles.test.ts
git commit -m "feat(auth): session reader and league role checks"
```

---

### Task 6: Move every v1 admin route from the admin token to sessions

One task on purpose: the 15 route files and their tests change together, and a half-converted API can't be reviewed on its own.

**Files:**
- Modify (every file below): replace `requireCommissioner(req, slug)` with `requireLeagueRole(slug, 'commissioner')`
  - `app/api/l/[slug]/admin/verify/route.ts`
  - `app/api/l/[slug]/admin/state/route.ts`
  - `app/api/l/[slug]/admin/league/route.ts`
  - `app/api/l/[slug]/admin/players/[id]/route.ts` (PATCH, DELETE)
  - `app/api/l/[slug]/admin/events/[eventKey]/route.ts`
  - `app/api/l/[slug]/admin/rounds/route.ts`
  - `app/api/l/[slug]/admin/rounds/[id]/route.ts` (GET, PATCH, DELETE)
  - `app/api/l/[slug]/admin/rounds/[id]/teams/route.ts`
  - `app/api/l/[slug]/admin/rounds/[id]/teams/[teamKey]/route.ts`
  - `app/api/l/[slug]/admin/rounds/[id]/picks/route.ts`
  - `app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts` (DELETE, PATCH)
  - `app/api/l/[slug]/admin/rounds/[id]/adjustments/route.ts`
  - `app/api/l/[slug]/admin/rounds/[id]/adjustments/[adjId]/route.ts` (PATCH, DELETE)
  - `app/api/l/[slug]/admin/rounds/[id]/refresh/route.ts`
- Delete: `app/api/l/[slug]/admin/players/route.ts` (the v1 "add player by name" route — spec §4.3)
- Modify: `lib/api/http.ts` (remove `requireCommissioner` and the `verifyToken` import)
- Modify: `tests/helpers/api.ts` (`request` loses `token`; `seedLeague` makes a commissioner account)
- Modify tests: `tests/api/{adjustments,events,http,league,picks,players,refresh,rounds}.test.ts`, `tests/views/views.test.ts`

**Interfaces:**
- Consumes: `requireLeagueRole` (Task 5), `fakeSession`/`setUser`/`makeUser`/`signInAsMember` (Task 5), `createMember`/`createProfile` (Task 4).
- Produces (contract): `request(method, path, opts?: { body?: unknown })`; `seedLeague(repo, opts?: { name?: string; slug?: string; visibility?: Visibility; signIn?: boolean }): Promise<{ league: LeagueRow; commissioner: PlayerRow; user: SessionUser }>` — creates a profile + league (`createdBy` = that user) + a commissioner member named **`Commish`**, and signs that user in unless `signIn: false`.

- [ ] **Step 1: Rewrite the request helper and `seedLeague`**

Replace `tests/helpers/api.ts` with:

```ts
import type { SessionUser } from '@/lib/auth/session';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, Visibility } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser } from './auth';

/** Builds a Request like the browser would send. A string body is sent as-is (for bad-JSON tests). */
export function request(method: string, path: string, opts: { body?: unknown } = {}): Request {
  const headers = new Headers();
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`http://test.local${path}`, { method, headers, body });
}

/** Next.js 16 passes route params as a Promise. */
export function params<T>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

/**
 * A league with one commissioner account named "Commish", signed in by default.
 * Pass { signIn: false } for a second league so the current user stays who they were.
 */
export async function seedLeague(
  repo: Repo,
  opts: { name?: string; slug?: string; visibility?: Visibility; signIn?: boolean } = {},
): Promise<{ league: LeagueRow; commissioner: PlayerRow; user: SessionUser }> {
  const user = await makeUser(repo, 'Commish');
  const league = await repo.createLeague({
    slug: opts.slug ?? 'habich-fam-abc234',
    name: opts.name ?? 'Habich Fam',
    defaultScoring: defaultScoring(),
    createdBy: user.id,
    visibility: opts.visibility,
  });
  const commissioner = await repo.createMember({
    leagueId: league.id,
    userId: user.id,
    name: 'Commish',
    role: 'commissioner',
  });
  if (opts.signIn !== false) setUser(user);
  return { league, commissioner, user };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  return res.json();
}
```

- [ ] **Step 2: Convert the tests mechanically**

Run this once from the repo root (a throwaway codemod; it is not committed):

```bash
node - <<'EOF'
const fs = require('fs');
const files = [
  'tests/api/adjustments.test.ts', 'tests/api/events.test.ts', 'tests/api/http.test.ts',
  'tests/api/league.test.ts', 'tests/api/picks.test.ts', 'tests/api/players.test.ts',
  'tests/api/refresh.test.ts', 'tests/api/rounds.test.ts', 'tests/views/views.test.ts',
];
const mockLine = "vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);";
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  s = s
    .replace(/\{ token, /g, '{ ')
    .replace(/\{ token \}/g, '{}')
    .replace(/^let token: string;\n/m, '')
    .replace(/\(\{ league, token \} = await seedLeague\(repo\)\)/g, '({ league } = await seedLeague(repo))')
    .replace(/const \{ league, token \} = await seedLeague\(repo\)/g, 'const { league } = await seedLeague(repo)')
    .replace(/seedLeague\(repo, \{ slug: ('[^']+') \}\)/g, 'seedLeague(repo, { slug: $1, signIn: false })');
  if (!s.includes(mockLine)) {
    // Right after the existing vi.mock('@/lib/db', ...) line.
    s = s.replace(/(vi\.mock\('@\/lib\/db'[^\n]*\n)/, `$1${mockLine}\n`);
  }
  fs.writeFileSync(f, s);
}
EOF
npm run typecheck 2>&1 | grep "tests/" | head -50
```

Expected: a short list of remaining type errors, all at the places handled by hand in Step 3 (`token: 'wrong'`, `token: t`, `token: other.token`, `token: a.token`, `hashToken`, `adminToken`).

- [ ] **Step 3: Fix the auth tests by hand**

Every v1 "403 without / with a wrong token" test becomes one test that checks **401 signed out** and **403 for a plain member**. Add `import { setUser, signInAsMember } from '../helpers/auth';` to each file that needs it, then replace each of these tests (keep the route call each one already makes — only the auth setup changes):

| File | v1 test name | Replace with |
|---|---|---|
| `tests/api/adjustments.test.ts:119` | answers 403 without a token | pattern A |
| `tests/api/events.test.ts:114` | answers 403 without a token, and does not call TBA | pattern A, plus the existing `expect(h.getTba).not.toHaveBeenCalled()` after each call |
| `tests/api/league.test.ts:103` | answers 403 for a missing or wrong token (verify) | pattern A |
| `tests/api/league.test.ts:148` | answers 403 without a token (state) | pattern A |
| `tests/api/league.test.ts:208` | answers 403 with the wrong token and changes nothing (PATCH) | pattern A, plus the existing "name unchanged" assertion |
| `tests/api/picks.test.ts:140` | answers 403 with a missing or wrong token | pattern A (call `pick(0, 'frc1')`) |
| `tests/api/picks.test.ts:~150` | another league's token… | pattern B |
| `tests/api/refresh.test.ts:61` | answers 403 without a token and does not call TBA | pattern A + TBA not called |
| `tests/api/rounds.test.ts:138` | answers 403 without a token | pattern A |
| `tests/api/rounds.test.ts:173` | answers 404 when league A's token asks for league B's round | keep as-is: `seedLeague(... signIn: false)` for league B already makes it "my commissioner session asks for league B's round" → still 404 |
| `tests/api/players.test.ts:68` | (POST) answers 403 … | delete (route removed) |

Pattern A (example from `tests/api/rounds.test.ts`; use the file's own route call in place of `addRound(...)`):

```ts
  it('answers 401 signed out and 403 for a member who is not a commissioner', async () => {
    setUser(null);
    const signedOut = await addRound(request('POST', '/x', { body: { eventKey: '2025parr' } }), params({ slug: league.slug }));
    expect(signedOut.status).toBe(401);

    await signInAsMember(repo, league, 'Mom', 'player');
    const member = await addRound(request('POST', '/x', { body: { eventKey: '2025parr' } }), params({ slug: league.slug }));
    expect(member.status).toBe(403);
    expect(await repo.listRounds(league.id)).toEqual([]);
  });
```

Pattern B (`tests/api/picks.test.ts`, the "other league" test):

```ts
  it("answers 403 when another league's commissioner tries to pick here", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' }); // signs in as other's commissioner
    const res = await pick(0, 'frc1');
    expect(res.status).toBe(403);
    expect(await repo.listPicks(round.id)).toEqual([]);
    setUser(other.user); // (keeps `other` used)
  });
```

In `tests/api/picks.test.ts` also change the helper to drop its token argument:

```ts
function pick(expectedPickNumber: number, teamKey: string) {
  return addPick(request('POST', '/x', { body: { expectedPickNumber, teamKey } }), here());
}
```

In `tests/api/http.test.ts` delete the whole `describe('requireCommissioner (§4)', …)` block and the `requireCommissioner` import (Task 5's `tests/auth/roles.test.ts` covers the replacement).

In `tests/api/players.test.ts` delete the `describe('POST /admin/players', …)` block and the `POST as addPlayer` import.

- [ ] **Step 4: Update expectations that now see the `Commish` row**

`seedLeague` adds a member named `Commish` (created first, so it's first in `listPlayers`). Update exactly these expectations:

- `tests/api/players.test.ts` — `expect(await repo.listPlayers(league.id)).toEqual([])` → `expect((await repo.listPlayers(league.id)).map((p) => p.name)).toEqual(['Commish'])`; `toHaveLength(1)` for `league.id` → `toHaveLength(2)`; for `other.league.id`, `toHaveLength(1)` → `toHaveLength(2)` and `[0].name` → `.find((p) => p.name === 'Stranger')` exists.
- `tests/api/league.test.ts:135` (state players): prepend `{ id: commissioner.id, name: 'Commish', inUse: false }` (destructure `commissioner` from `seedLeague`). Drop the `homeTeamNumber`-token lines only if they reference `token`; keep `homeTeamNumber` assertions.
- `tests/api/league.test.ts:128-129`: `expect(text).not.toContain(league.adminTokenHash)` → delete (it's `null` now); keep `expect(text).not.toContain('adminTokenHash')`.
- `tests/api/rounds.test.ts:167`: `['Mom', 'Dad']` → `['Commish', 'Mom', 'Dad']`.
- `tests/views/views.test.ts:117`: add `[commissioner.id]: 'Commish'` (destructure it in `beforeEach`), and `tests/views/views.test.ts:122` `not.toContain(league.adminTokenHash)` → `not.toContain('adminTokenHash')`.
- `tests/views/views.test.ts` standings (`:243`) — a player with no rounds appears with total 0 and the last rank; add Commish's row where the test lists every player.
- `tests/views/views.test.ts:291` ("works for a league with no rounds or players"): the empty league now has its Commish member, so change `standings: []` to `standings: [expect.objectContaining({ name: 'Commish', total: 0, rank: 1 })]` and rename the test to "…no rounds".
- `tests/api/players.test.ts` rename tests: renaming a player to `'Commish'` now clashes — none of the v1 tests do, but if a new failure mentions `players_league_name_ci`, pick a different name in the test.

Leave the `POST /api/leagues` tests in `tests/api/league.test.ts` alone; Task 8 rewrites them.

- [ ] **Step 5: Run the tests to see the conversion fail**

Run: `npx vitest run tests/api tests/views`
Expected: FAIL — the routes still call `requireCommissioner` (no header → 403 where the tests now expect 200/401).

- [ ] **Step 6: Convert the routes**

In each route file in the list above:

```ts
// before
import { handle, json, parseBody, requireCommissioner } from '@/lib/api/http';
…
    const league = await requireCommissioner(req, slug);
// after
import { handle, json, parseBody } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
…
    const { league } = await requireLeagueRole(slug, 'commissioner');
```

Where `req` is no longer used (for example `verify`, `state`, `GET` round, `DELETE` routes), rename the parameter to `_req` so the signature stays `(req, ctx)`-shaped for Next.js. Delete `app/api/l/[slug]/admin/players/route.ts`.

In `lib/api/http.ts`, delete `requireCommissioner` and the `import { verifyToken } from '@/lib/auth/commissioner';` line.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass. The count drops by the deleted POST-player and `requireCommissioner` tests and rises by the new 401/403 tests — note both numbers in the commit message.

- [ ] **Step 8: Commit**

```bash
git add -A app/api/l lib/api/http.ts tests/helpers/api.ts tests/api tests/views
git commit -m "feat(auth): admin routes use session + commissioner role instead of the admin token"
```

---

### Task 7: Members — roles, remove-or-unlink, the last-commissioner rule

**Files:**
- Create: `lib/leagues/membership.ts`
- Modify: `app/api/l/[slug]/admin/players/[id]/route.ts`, `app/api/l/[slug]/admin/state/route.ts`, `lib/api/types.ts` (`AdminPlayer`)
- Test: `tests/leagues/membership.test.ts`, `tests/api/players.test.ts`

**Interfaces:**
- Consumes: `playersInUse` (`lib/rounds/usage.ts`), repo `updatePlayer`/`deletePlayer`/`listPlayers`.
- Produces: `MAX_PLAYERS = 30`, `MAX_LEAGUES_PER_USER = 5`, `LAST_COMMISSIONER_MESSAGE`, `assertKeepsCommissioner(players: PlayerRow[], target: PlayerRow): void` (throws `HttpError(409, LAST_COMMISSIONER_MESSAGE)` if `target` is the only linked commissioner), `removeMember(repo: Repo, player: PlayerRow): Promise<'deleted' | 'unlinked'>`. `AdminPlayer` becomes `{ id; name; inUse: boolean; role: LeagueRole; linked: boolean }`.
- Routes: `PATCH /api/l/{slug}/admin/players/{id}` body `{ name?: string; role?: 'commissioner' | 'player' }` (at least one); `DELETE` → 204 whether deleted or unlinked, JSON `{ result: 'deleted' | 'unlinked' }` with 200 when unlinked.

- [ ] **Step 1: Write the failing unit tests**

`tests/leagues/membership.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertKeepsCommissioner, LAST_COMMISSIONER_MESSAGE, removeMember } from '@/lib/leagues/membership';
import type { PlayerRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { createMemoryRepo } from '../helpers/memoryRepo';

const row = (id: string, role: PlayerRow['role'], userId: string | null): PlayerRow => ({
  id, leagueId: 'L', name: id, role, userId, createdAt: '2026-01-01T00:00:00.000Z',
});

describe('assertKeepsCommissioner (spec §4.3)', () => {
  it('blocks removing or demoting the only linked commissioner', () => {
    const joey = row('joey', 'commissioner', 'u1');
    const mom = row('mom', 'player', 'u2');
    expect(() => assertKeepsCommissioner([joey, mom], joey)).toThrow(LAST_COMMISSIONER_MESSAGE);
  });
  it('ignores unlinked commissioners when counting', () => {
    const joey = row('joey', 'commissioner', 'u1');
    const gone = row('gone', 'commissioner', null);
    expect(() => assertKeepsCommissioner([joey, gone], joey)).toThrow();
  });
  it('allows it when another linked commissioner exists, or the target is a player', () => {
    const joey = row('joey', 'commissioner', 'u1');
    const mom = row('mom', 'commissioner', 'u2');
    expect(() => assertKeepsCommissioner([joey, mom], joey)).not.toThrow();
    expect(() => assertKeepsCommissioner([joey, mom], row('dad', 'player', 'u3'))).not.toThrow();
  });
});

describe('removeMember (spec §4.3)', () => {
  async function setup() {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    await repo.createProfile({ id: 'u-mom', displayName: 'Mom', avatarUrl: null });
    const mom = await repo.createMember({ leagueId: league.id, userId: 'u-mom', name: 'Mom', role: 'commissioner' });
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
      endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    return { repo, league, mom, round };
  }

  it('deletes a member with no history', async () => {
    const { repo, league, mom } = await setup();
    expect(await removeMember(repo, mom)).toBe('deleted');
    expect(await repo.listPlayers(league.id)).toEqual([]);
  });

  it('unlinks (and demotes) a member who has picks, keeping the name', async () => {
    const { repo, league, mom, round } = await setup();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    expect(await removeMember(repo, mom)).toBe('unlinked');
    const [kept] = await repo.listPlayers(league.id);
    expect(kept).toMatchObject({ id: mom.id, name: 'Mom', userId: null, role: 'player' });
    expect(await repo.listPicks(round.id)).toHaveLength(1);
  });

  it('unlinks a member who is only in a draft order', async () => {
    const { repo, mom, round } = await setup();
    await repo.updateRound(round.id, { draftOrder: [mom.id] });
    expect(await removeMember(repo, mom)).toBe('unlinked');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/leagues/membership.test.ts`
Expected: FAIL — cannot resolve `@/lib/leagues/membership`.

- [ ] **Step 3: Implement `lib/leagues/membership.ts`**

```ts
import { HttpError } from '@/lib/api/http';
import type { Repo } from '@/lib/db/repo';
import type { PlayerRow } from '@/lib/db/types';
import { playersInUse } from '@/lib/rounds/usage';

export const MAX_PLAYERS = 30; // per league, counting unlinked rows (spec §4.3)
export const MAX_LEAGUES_PER_USER = 5; // created by one user (spec §4.4)

export const LAST_COMMISSIONER_MESSAGE =
  'A league needs at least one commissioner. Make someone else commissioner first.';

/** Throws 409 if `target` is the league's only commissioner who still has an account. */
export function assertKeepsCommissioner(players: PlayerRow[], target: PlayerRow): void {
  if (target.role !== 'commissioner' || target.userId === null) return;
  const others = players.filter((p) => p.id !== target.id && p.role === 'commissioner' && p.userId !== null);
  if (others.length === 0) throw new HttpError(409, LAST_COMMISSIONER_MESSAGE);
}

/**
 * Remove member / leave / account deletion (spec §4.3): a row with no picks, adjustments or
 * draft-order entries is deleted; otherwise it is unlinked so history and standings stay intact.
 */
export async function removeMember(repo: Repo, player: PlayerRow): Promise<'deleted' | 'unlinked'> {
  const used = await playersInUse(repo, player.leagueId);
  if (used.has(player.id)) {
    await repo.updatePlayer(player.id, { userId: null, role: 'player' });
    return 'unlinked';
  }
  await repo.deletePlayer(player.id);
  return 'deleted';
}
```

- [ ] **Step 4: Rewrite the players route tests**

In `tests/api/players.test.ts`, replace the `DELETE` describe block's v1 "409 for a player who is in a draft order" and "409 for a player who has an adjustment" tests, and add role tests. The file's `beforeEach` already does `({ league } = await seedLeague(repo))` (signed in as Commish); destructure `commissioner` too.

```ts
describe('PATCH /admin/players/{id} role (spec §4.3)', () => {
  it('promotes and demotes a member', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: (await makeUser(repo, 'Mom')).id, name: 'Mom', role: 'player' });
    const up = await renamePlayer(request('PATCH', '/x', { body: { role: 'commissioner' } }), params({ slug: league.slug, id: mom.id }));
    expect(up.status).toBe(200);
    expect((await readJson(up)).player).toMatchObject({ role: 'commissioner', linked: true });
    const down = await renamePlayer(request('PATCH', '/x', { body: { role: 'player' } }), params({ slug: league.slug, id: mom.id }));
    expect((await readJson(down)).player.role).toBe('player');
  });

  it('refuses to demote the last commissioner', async () => {
    const res = await renamePlayer(request('PATCH', '/x', { body: { role: 'player' } }), params({ slug: league.slug, id: commissioner.id }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe(LAST_COMMISSIONER_MESSAGE);
  });

  it('refuses to make an unlinked row a commissioner', async () => {
    const gone = await repo.createPlayer(league.id, 'Gone');
    const res = await renamePlayer(request('PATCH', '/x', { body: { role: 'commissioner' } }), params({ slug: league.slug, id: gone.id }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe("Gone has left the league, so they can't be a commissioner");
  });

  it('answers 400 for an empty patch', async () => {
    const res = await renamePlayer(request('PATCH', '/x', { body: {} }), params({ slug: league.slug, id: commissioner.id }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /admin/players/{id} (remove member)', () => {
  it('deletes a member with no history', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: (await makeUser(repo, 'Mom')).id, name: 'Mom', role: 'player' });
    const res = await deletePlayer(request('DELETE', '/x'), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(204);
    expect((await repo.listPlayers(league.id)).map((p) => p.name)).toEqual(['Commish']);
  });

  it('unlinks a member who has picks and says so', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: (await makeUser(repo, 'Mom')).id, name: 'Mom', role: 'player' });
    const round = await addRound();
    await repo.updateRound(round.id, { draftOrder: [mom.id] });
    const res = await deletePlayer(request('DELETE', '/x'), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ result: 'unlinked' });
    expect((await repo.listPlayers(league.id)).find((p) => p.id === mom.id)!.userId).toBeNull();
  });

  it('refuses to remove the last commissioner (including yourself)', async () => {
    const res = await deletePlayer(request('DELETE', '/x'), params({ slug: league.slug, id: commissioner.id }));
    expect(res.status).toBe(409);
    expect(await repo.listPlayers(league.id)).toHaveLength(1);
  });
});
```

Add the imports `import { LAST_COMMISSIONER_MESSAGE } from '@/lib/leagues/membership';` and `makeUser` from `../helpers/auth`. Keep the v1 rename tests and the "404 for another league's player" tests as they are.

- [ ] **Step 5: Run to see them fail**

Run: `npx vitest run tests/api/players.test.ts`
Expected: FAIL — `role` ignored / DELETE still answers 409 for a used player.

- [ ] **Step 6: Implement the route and `AdminPlayer`**

`lib/api/types.ts` — change `AdminPlayer`:

```ts
export type AdminPlayer = {
  id: string;
  name: string;
  /** True when the player has picks or adjustments, or is in any draft order. Removing them unlinks instead of deleting. */
  inUse: boolean;
  role: LeagueRole;
  /** False for a former member ("Mom (left)"). */
  linked: boolean;
};
```

(`import type { LeagueRole } from '@/lib/db/types';` at the top.)

`app/api/l/[slug]/admin/players/[id]/route.ts` (whole file):

```ts
import { z } from 'zod';
import { handle, HttpError, isUuid, json, noContent, parseBody } from '@/lib/api/http';
import type { AdminPlayer } from '@/lib/api/types';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import type { LeagueRow, PlayerRow } from '@/lib/db/types';
import { assertKeepsCommissioner, removeMember } from '@/lib/leagues/membership';
import { nameSchema } from '@/lib/leagues/names';
import { playersInUse } from '@/lib/rounds/usage';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z
  .strictObject({
    name: nameSchema.optional(),
    role: z.enum(['commissioner', 'player'], 'role must be commissioner or player').optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined, { message: 'Nothing to change' });

async function loadPlayers(league: LeagueRow, id: string): Promise<{ players: PlayerRow[]; player: PlayerRow }> {
  if (!isUuid(id)) throw new HttpError(404, 'Player not found');
  const players = await getRepo().listPlayers(league.id);
  const player = players.find((p) => p.id === id);
  if (!player) throw new HttpError(404, 'Player not found');
  return { players, player };
}

function toAdminPlayer(p: PlayerRow, used: Set<string>): AdminPlayer {
  return { id: p.id, name: p.name, inUse: used.has(p.id), role: p.role, linked: p.userId !== null };
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const { players, player } = await loadPlayers(league, id);
    const patch = await parseBody(req, patchSchema);

    if (patch.role === 'commissioner' && player.userId === null) {
      throw new HttpError(409, `${player.name} has left the league, so they can't be a commissioner`);
    }
    if (patch.role === 'player') assertKeepsCommissioner(players, player);

    const repo = getRepo();
    const saved = await repo.updatePlayer(player.id, { name: patch.name, role: patch.role });
    return json({ player: toAdminPlayer(saved, await playersInUse(repo, league.id)) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const { players, player } = await loadPlayers(league, id);
    assertKeepsCommissioner(players, player);
    const result = await removeMember(getRepo(), player);
    return result === 'deleted' ? noContent() : json({ result });
  });
}
```

In `app/api/l/[slug]/admin/state/route.ts`, map players with the same fields:

```ts
      players: players.map((p) => ({
        id: p.id, name: p.name, inUse: used.has(p.id), role: p.role, linked: p.userId !== null,
      })),
```

and update `tests/api/league.test.ts` state expectations to include `role` and `linked` on each player (`Commish`: `role: 'commissioner', linked: true`; `Mom`/`Dad` made with `createPlayer`: `role: 'player', linked: false`).

The v1 rename tests' "rename" error text for a used player (`/rename/i`) is gone with the 409; delete that assertion if it remains.

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/leagues tests/api && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/leagues/membership.ts lib/api/types.ts "app/api/l/[slug]/admin/players/[id]/route.ts" "app/api/l/[slug]/admin/state/route.ts" tests/leagues/membership.test.ts tests/api/players.test.ts tests/api/league.test.ts
git commit -m "feat(leagues): member roles, remove-or-unlink, last-commissioner guard"
```

---

### Task 8: Create league, visibility, delete league, reset invite code

**Files:**
- Modify: `app/api/leagues/route.ts` (rewrite), `app/api/l/[slug]/admin/league/route.ts` (PATCH `visibility`, new `DELETE`), `lib/api/types.ts` (`AdminLeague`), `app/api/l/[slug]/admin/state/route.ts`
- Create: `app/api/l/[slug]/admin/invite/route.ts`
- Test: `tests/api/league.test.ts` (replace the `POST /api/leagues` block; add PATCH visibility, DELETE, invite tests)

**Interfaces:**
- Consumes: `requireUser` (Task 5), `requireLeagueRole` (Task 5), `MAX_LEAGUES_PER_USER` (Task 7), repo `countLeaguesCreatedBy`/`createMember`/`getProfile`/`resetInviteCode`/`deleteLeague`.
- Produces:
  - `POST /api/leagues` body `{ name: string (1–80), visibility?: 'link' | 'members' }` → 201 `{ slug, inviteCode }`; 401 signed out; 409 `"You've reached the 5-league limit"`.
  - `PATCH /api/l/{slug}/admin/league` accepts `visibility`.
  - `DELETE /api/l/{slug}/admin/league` body `{ confirmName: string }` → 204; 400 `"Type the league name exactly to delete it"` on mismatch.
  - `POST /api/l/{slug}/admin/invite` → 200 `{ inviteCode }`.
  - `AdminLeague` gains `inviteCode: string; visibility: Visibility`.

- [ ] **Step 1: Write the failing tests**

In `tests/api/league.test.ts`, delete the whole `describe('POST /api/leagues', …)` block, the `vi.stubEnv('CREATE_LEAGUE_PASSCODE', …)` line in `beforeEach`, and the `hashToken` import. Add these imports: `import { DELETE as deleteLeague } from '@/app/api/l/[slug]/admin/league/route';` (extend the existing `PATCH as patchLeague` import), `import { POST as resetInvite } from '@/app/api/l/[slug]/admin/invite/route';`, and `makeUser`, `setUser`, `signInAsMember` from `../helpers/auth`. Then add:

```ts
describe('POST /api/leagues (spec §4.4)', () => {
  it('creates a league with an invite code and makes the creator its commissioner', async () => {
    const user = await makeUser(repo, 'Joey');
    setUser(user);
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: '  Habich Fam ' } }));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.slug).toMatch(/^habich-fam-[a-z2-7]{6}$/);
    expect(body.inviteCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

    const league = (await repo.getLeagueBySlug(body.slug))!;
    expect(league).toMatchObject({ name: 'Habich Fam', visibility: 'link', createdBy: user.id, adminTokenHash: null });
    expect(league.defaultScoring).toEqual(DEFAULT_SCORING);
    const [me] = await repo.listPlayers(league.id);
    expect(me).toMatchObject({ name: 'Joey', userId: user.id, role: 'commissioner' });
  });

  it('honours visibility', async () => {
    setUser(await makeUser(repo, 'Joey'));
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'Secret', visibility: 'members' } }));
    const { slug } = await readJson(res);
    expect((await repo.getLeagueBySlug(slug))!.visibility).toBe('members');
  });

  it('answers 401 signed out and creates nothing', async () => {
    setUser(null);
    const spy = vi.spyOn(repo, 'createLeague');
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'Fam' } }));
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops at 5 created leagues', async () => {
    setUser(await makeUser(repo, 'Joey'));
    for (let i = 0; i < 5; i++) {
      expect((await createLeague(request('POST', '/api/leagues', { body: { name: `L${i}` } }))).status).toBe(201);
    }
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'One too many' } }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe("You've reached the 5-league limit");
  });

  it('answers 400 for a bad name or visibility', async () => {
    setUser(await makeUser(repo, 'Joey'));
    for (const body of [{ name: '' }, { name: 'x'.repeat(81) }, { name: 'ok', visibility: 'public' }, {}]) {
      expect((await createLeague(request('POST', '/api/leagues', { body }))).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('PATCH /admin/league visibility', () => {
  it('switches between link and members', async () => {
    const { league } = await seedLeague(repo);
    const res = await patchLeague(request('PATCH', '/x', { body: { visibility: 'members' } }), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).league.visibility).toBe('members');
    expect((await repo.getLeagueBySlug(league.slug))!.visibility).toBe('members');
  });
});

describe('DELETE /admin/league (spec §4.4)', () => {
  it('deletes the league when the typed name matches', async () => {
    const { league } = await seedLeague(repo);
    const res = await deleteLeague(request('DELETE', '/x', { body: { confirmName: 'Habich Fam' } }), params({ slug: league.slug }));
    expect(res.status).toBe(204);
    expect(await repo.getLeagueBySlug(league.slug)).toBeNull();
  });
  it('answers 400 and keeps the league when the name is wrong', async () => {
    const { league } = await seedLeague(repo);
    const res = await deleteLeague(request('DELETE', '/x', { body: { confirmName: 'habich fam' } }), params({ slug: league.slug }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('Type the league name exactly to delete it');
    expect(await repo.getLeagueBySlug(league.slug)).not.toBeNull();
  });
  it('is commissioner-only', async () => {
    const { league } = await seedLeague(repo);
    await signInAsMember(repo, league, 'Mom');
    const res = await deleteLeague(request('DELETE', '/x', { body: { confirmName: 'Habich Fam' } }), params({ slug: league.slug }));
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/invite', () => {
  it('replaces the invite code; the old one stops working', async () => {
    const { league } = await seedLeague(repo);
    const res = await resetInvite(request('POST', '/x'), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    const { inviteCode } = await readJson(res);
    expect(inviteCode).not.toBe(league.inviteCode);
    expect(await repo.getLeagueByInviteCode(league.inviteCode)).toBeNull();
    expect((await repo.getLeagueByInviteCode(inviteCode))!.id).toBe(league.id);
  });
});
```

Also update the existing state test's `body.league` expectation to include `inviteCode: league.inviteCode, visibility: 'link'`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/api/league.test.ts`
Expected: FAIL — `POST /api/leagues` still wants a passcode; `DELETE`/`resetInvite` don't exist.

- [ ] **Step 3: Implement**

`app/api/leagues/route.ts` (whole file):

```ts
import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/api/http';
import { makeSlug } from '@/lib/auth/commissioner';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { UniqueViolation } from '@/lib/db/repo';
import { MAX_LEAGUES_PER_USER } from '@/lib/leagues/membership';
import { defaultScoring } from '@/lib/scoring/config';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z
    .string('League name is required')
    .trim()
    .min(1, 'League name is required')
    .max(80, 'League name must be 80 characters or fewer'),
  visibility: z.enum(['link', 'members'], 'visibility must be link or members').optional(),
});

/** Create a league (spec §4.4). The creator becomes its first commissioner. */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const body = await parseBody(req, bodySchema);
    const repo = getRepo();

    if ((await repo.countLeaguesCreatedBy(user.id)) >= MAX_LEAGUES_PER_USER) {
      throw new HttpError(409, `You've reached the ${MAX_LEAGUES_PER_USER}-league limit`);
    }
    const profile = await repo.getProfile(user.id);
    const myName = profile?.displayName ?? 'Player';

    for (let attempt = 0; attempt < 5; attempt++) {
      let league;
      try {
        league = await repo.createLeague({
          slug: makeSlug(body.name),
          name: body.name,
          defaultScoring: defaultScoring(),
          createdBy: user.id,
          visibility: body.visibility ?? 'link',
        });
      } catch (err) {
        // A clash on the random slug or the random invite code: try again with new ones.
        if (err instanceof UniqueViolation && ['leagues_slug_key', 'leagues_invite_code_key'].includes(err.constraint)) {
          continue;
        }
        throw err;
      }
      try {
        await repo.createMember({ leagueId: league.id, userId: user.id, name: myName, role: 'commissioner' });
      } catch (err) {
        await repo.deleteLeague(league.id); // no commissioner-less leagues left behind
        throw err;
      }
      return json({ slug: league.slug, inviteCode: league.inviteCode }, 201);
    }
    throw new HttpError(500, 'Could not make a unique link. Try again.');
  });
}
```

`app/api/l/[slug]/admin/league/route.ts` — add `visibility` to `patchSchema`, return it, and add `DELETE`:

```ts
    visibility: z.enum(['link', 'members'], 'visibility must be link or members').optional(),
```

```ts
function toAdminLeague(l: LeagueRow): AdminLeague {
  return {
    slug: l.slug,
    name: l.name,
    homeTeamNumber: l.homeTeamNumber,
    defaultScoring: l.defaultScoring,
    inviteCode: l.inviteCode,
    visibility: l.visibility,
  };
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const patch = await parseBody(req, patchSchema);
    const saved = await getRepo().updateLeague(league.id, patch);
    return json({ league: toAdminLeague(saved) });
  });
}

const deleteSchema = z.object({ confirmName: z.string('Type the league name to delete it').max(200) });

/** Delete league (spec §4.4): the commissioner types the league name exactly. Cascades like v1. */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const { confirmName } = await parseBody(req, deleteSchema);
    if (confirmName.trim() !== league.name) throw new HttpError(400, 'Type the league name exactly to delete it');
    await getRepo().deleteLeague(league.id);
    return noContent();
  });
}
```

(imports: `HttpError`, `noContent` from `@/lib/api/http`; `type AdminLeague` from `@/lib/api/types`; `type LeagueRow` from `@/lib/db/types`.)

`lib/api/types.ts` — `AdminLeague` gains `inviteCode: string; visibility: Visibility;` (import `Visibility`). In `app/api/l/[slug]/admin/state/route.ts` add `inviteCode: league.inviteCode, visibility: league.visibility` to `league`.

`app/api/l/[slug]/admin/invite/route.ts`:

```ts
import { handle, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** Reset invite code (spec §4.4): old links and codes stop working immediately. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const saved = await getRepo().resetInviteCode(league.id);
    return json({ inviteCode: saved.inviteCode });
  });
}
```

- [ ] **Step 4: Move the browser client and the form to the new API**

In `lib/admin/client.ts` replace `createLeague`:

```ts
export function createLeague(
  input: { name: string; visibility?: 'link' | 'members' },
  fetchImpl: typeof fetch = fetch,
): Promise<{ slug: string; inviteCode: string }> {
  return send('/api/leagues', { method: 'POST', body: input }, fetchImpl);
}
```

In `tests/admin/client.test.ts` replace the two `createLeague` tests:

```ts
describe('createLeague', () => {
  it('posts the name and visibility and returns slug + invite code', async () => {
    const fetchImpl = respond(201, { slug: 'fam-abc234', inviteCode: 'ABC234' });
    const out = await createLeague({ name: 'Fam', visibility: 'members' }, fetchImpl);
    expect(out).toEqual({ slug: 'fam-abc234', inviteCode: 'ABC234' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/leagues');
    expect(JSON.parse(init.body)).toEqual({ name: 'Fam', visibility: 'members' });
  });
  it('surfaces the server message (e.g. the 5-league cap)', async () => {
    const attempt = createLeague({ name: 'Fam' }, respond(409, { error: "You've reached the 5-league limit" }));
    await expect(attempt).rejects.toMatchObject({ status: 409, message: "You've reached the 5-league limit" });
  });
});
```

In `components/CreateLeagueForm.tsx` (interim; Task 17 gives it its final shape): delete the `passcode` state, its `<Input>` and `setPasscode('')`; call `createLeague({ name })`; and on success `window.location.assign('/l/' + slug + '/admin')` instead of showing the admin-link card. Delete the `Created` type, the `created` state and its render branch, and the `adminLinkFor` import.

- [ ] **Step 5: Run tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/leagues/route.ts "app/api/l/[slug]/admin/league/route.ts" "app/api/l/[slug]/admin/invite/route.ts" "app/api/l/[slug]/admin/state/route.ts" lib/api/types.ts lib/admin/client.ts components/CreateLeagueForm.tsx tests/api/league.test.ts tests/admin/client.test.ts
git commit -m "feat(leagues): signed-in league creation with caps, visibility, delete, invite reset"
```

---
## Batch B continued

### Task 9: Remove the admin-token code; admin pages check the session

**Files:**
- Delete: `lib/auth/rotate.ts`, `scripts/rotate-admin-token.ts`, `tests/auth/rotate.test.ts`, `components/CommissionerTag.tsx`
- Modify: `lib/auth/commissioner.ts` (keep `SLUG_RE`, `safeEqual`, `makeSlug` only), `tests/auth/commissioner.test.ts`
- Modify: `lib/admin/client.ts`, `tests/admin/client.test.ts`
- Modify: `lib/auth/next.ts` (add `oauthRedirectUrl`), `tests/auth/next.test.ts`
- Create: `components/SignInButtons.tsx`
- Modify: `components/admin/useAdmin.ts`, `components/admin/AdminGate.tsx`, `tests/ui/admin-components.test.ts`
- Modify: `components/TabBar.tsx` (`showAdmin` prop), `components/LeagueBar.tsx` (`isCommissioner` prop), `app/l/[slug]/layout.tsx`, `tests/ui/shell.test.ts`
- Modify: `scripts/seed-demo.ts` (owner account instead of an admin link)

**Interfaces:**
- Consumes: `leagueAccess` (Task 5), `createBrowserSupabase` (Task 1), `safeNext` (Task 1).
- Produces: `adminFetch<T>(slug: string, path: string, init?: { method?: string; body?: unknown }, fetchImpl?: typeof fetch): Promise<T>` (cookie-based, no header); `AdminSession = { status: 'checking' } | { status: 'signed_out' } | { status: 'forbidden' } | { status: 'error'; message: string } | { status: 'ready'; api: AdminApi }`; `AdminGateView({ slug, session, next, children })` (pure, testable); `oauthRedirectUrl(origin: string, next: string): string`; `<SignInButtons next={string} />`; `TabBar({ slug, targetRoundId, showAdmin })`; `LeagueBar({ …, isCommissioner?: boolean })`.

- [ ] **Step 1: Write the failing tests**

`tests/auth/next.test.ts` — append:

```ts
import { oauthRedirectUrl } from '@/lib/auth/next';

describe('oauthRedirectUrl', () => {
  it('points the provider back at /auth/callback with a sanitized next', () => {
    expect(oauthRedirectUrl('https://frc.example', '/join/ABC234')).toBe(
      'https://frc.example/auth/callback?next=%2Fjoin%2FABC234',
    );
    expect(oauthRedirectUrl('https://frc.example/', '//evil.com')).toBe('https://frc.example/auth/callback?next=%2F');
  });
});
```

`tests/admin/client.test.ts` — delete the `storageKey`, `tokenFromHash` and `adminLinkFor` describe blocks and their imports. Rewrite the `adminFetch` tests to the new signature (drop the `TOKEN` argument everywhere) and add:

```ts
  it('sends no commissioner header; the session cookie does the work', async () => {
    const fetchImpl = respond(200, { ok: true });
    await adminFetch('fam-abc234', '/state', {}, fetchImpl);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/l/fam-abc234/admin/state');
    expect(init.headers['x-commissioner-key']).toBeUndefined();
    expect(init.credentials).toBe('same-origin');
  });
```

`tests/ui/admin-components.test.ts` — replace the `AdminGate` describe:

```ts
import { AdminGateView } from '@/components/admin/AdminGate';

describe('AdminGateView', () => {
  const kids = () => h('p', null, 'secret dashboard');
  it('shows the checking state first', () => {
    const html = render(h(AdminGateView, { slug: 'abc', next: '/l/abc/admin', session: { status: 'checking' }, children: kids }));
    expect(html).toContain('Checking your account…');
    expect(html).not.toContain('secret dashboard');
  });
  it('asks a signed-out visitor to sign in and come back here', () => {
    const html = render(h(AdminGateView, { slug: 'abc', next: '/l/abc/admin/r/1', session: { status: 'signed_out' }, children: kids }));
    expect(html).toContain('Sign in to manage this league');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Continue with Discord');
    expect(html).not.toContain('secret dashboard');
  });
  it('tells a signed-in non-commissioner plainly', () => {
    const html = render(h(AdminGateView, { slug: 'abc', next: '/l/abc/admin', session: { status: 'forbidden' }, children: kids }));
    expect(html).toContain("You're not a commissioner of this league");
    expect(html).toContain('href="/l/abc"');
  });
});
```

`tests/ui/shell.test.ts` — add to the `LeagueBar` describe:

```ts
  it('shows the Commissioner label only when told the viewer is one', () => {
    expect(render(h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: false }))).not.toContain('Commissioner');
    expect(render(h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: false, isCommissioner: true }))).toContain('Commissioner');
  });
```

`tests/auth/commissioner.test.ts` — delete the `describe('admin tokens (§4)', …)` block and the `generateAdminToken`, `hashToken`, `verifyToken` imports.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/auth tests/admin tests/ui`
Expected: FAIL — `oauthRedirectUrl` / `AdminGateView` not exported; `adminFetch` arity; `isCommissioner` ignored.

- [ ] **Step 3: Delete the token code**

```bash
git rm lib/auth/rotate.ts scripts/rotate-admin-token.ts tests/auth/rotate.test.ts components/CommissionerTag.tsx
```

`lib/auth/commissioner.ts` — delete `MAX_TOKEN_LENGTH`, `generateAdminToken`, `hashToken`, `verifyToken`; change the import to `import { createHash, randomInt, timingSafeEqual } from 'node:crypto';`. `safeEqual` and `makeSlug` stay (the cron and test-login routes use `safeEqual`).

`lib/admin/client.ts` — delete `storageKey`, `TOKEN_RE`, `tokenFromHash`, `adminLinkFor`; in `send` add `credentials: 'same-origin'` to the `fetchImpl` init; replace `adminFetch`:

```ts
/** Calls /api/l/{slug}/admin/*. The browser sends the Supabase session cookie; there is no token any more. */
export function adminFetch<T>(
  slug: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  return send<T>(`/api/l/${encodeURIComponent(slug)}/admin${path}`, init, fetchImpl);
}
```

- [ ] **Step 4: Add `oauthRedirectUrl` and `SignInButtons`**

Append to `lib/auth/next.ts`:

```ts
/** Where the OAuth provider sends the browser back to (spec §4.1). */
export function oauthRedirectUrl(origin: string, next: string): string {
  return `${origin.replace(/\/+$/, '')}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}
```

`components/SignInButtons.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { oauthRedirectUrl } from '@/lib/auth/next';
import { createBrowserSupabase } from '@/lib/supabase/browser';

type Provider = 'google' | 'discord';

/** "Continue with Google / Discord" (spec §4.1). `next` is where to land after signing in. */
export function SignInButtons({ next = '/' }: { next?: string }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setBusy(provider);
    setError(null);
    const { error: err } = await createBrowserSupabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: oauthRedirectUrl(window.location.origin, next) },
    });
    // On success the browser is already leaving for the provider; only failures come back here.
    if (err) {
      setError("Sign-in didn't start. Try again.");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button type="button" busy={busy === 'google'} disabled={busy !== null} onClick={() => signIn('google')}>
        Continue with Google
      </Button>
      <Button
        type="button"
        variant="secondary"
        busy={busy === 'discord'}
        disabled={busy !== null}
        onClick={() => signIn('discord')}
      >
        Continue with Discord
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
```

- [ ] **Step 5: Session-based `useAdmin` and `AdminGate`**

`components/admin/useAdmin.ts` (whole file):

```ts
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
```

`components/admin/AdminGate.tsx` — keep the `BTN*`/`INPUT`/`TITLE` exports; replace the component part with a pure view plus the hook wrapper:

```tsx
export function AdminGateView({
  slug,
  next,
  session,
  children,
}: {
  slug: string;
  /** Where sign-in should return to: the admin page the visitor opened. */
  next: string;
  session: AdminSession;
  children: (api: AdminApi) => ReactNode;
}) {
  if (session.status === 'checking') {
    return (
      <main id="main">
        <p role="status" className="flex min-h-11 items-center gap-3 text-fg-muted">
          <span
            aria-hidden="true"
            className="size-5 shrink-0 rounded-full border-2 border-primary border-r-transparent motion-safe:animate-spin"
          />
          Checking your account…
        </p>
      </main>
    );
  }
  if (session.status === 'signed_out') {
    return (
      <main id="main">
        <Card className="space-y-3">
          <h1 className={TITLE}>Sign in to manage this league</h1>
          <p className="text-[15px] text-fg-muted">Commissioners sign in with the account they made the league with.</p>
          <SignInButtons next={next} />
        </Card>
      </main>
    );
  }
  if (session.status === 'forbidden') {
    return (
      <main id="main">
        <Card className="space-y-3">
          <h1 className={TITLE}>You&apos;re not a commissioner of this league</h1>
          <p className="text-[15px] text-fg-muted">
            Ask a commissioner to make you one from the league&apos;s Members section.
          </p>
          <Button href={`/l/${slug}`} variant="secondary">
            View standings
          </Button>
        </Card>
      </main>
    );
  }
  if (session.status === 'error') {
    return (
      <main id="main">
        <Card className="space-y-4">
          <h1 className={TITLE}>Can&apos;t load the admin page</h1>
          <Alert tone="danger">{session.message}</Alert>
          <Button type="button" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4 shrink-0" />
            Try again
          </Button>
        </Card>
      </main>
    );
  }
  return <>{children(session.api)}</>;
}

export function AdminGate({ slug, children }: { slug: string; children: (api: AdminApi) => ReactNode }) {
  const session = useAdmin(slug);
  const pathname = usePathname();
  return (
    <AdminGateView slug={slug} next={pathname ?? `/l/${slug}/admin`} session={session}>
      {children}
    </AdminGateView>
  );
}
```

(imports: add `import { usePathname } from 'next/navigation';`, `import { SignInButtons } from '@/components/SignInButtons';`, `import { useAdmin, type AdminSession } from '@/components/admin/useAdmin';`.)

- [ ] **Step 6: Admin tab and label come from the server**

`components/TabBar.tsx`: delete `hasAdminToken`, the `useEffect`/`useState` block and the `@/lib/admin/client` import; add a `showAdmin: boolean` prop and use it directly:

```tsx
export function TabBar({ slug, targetRoundId, showAdmin }: { slug: string; targetRoundId: string | null; showAdmin: boolean }) {
  const pathname = usePathname();
  const current = activeTab(pathname ?? '', slug);
  const tabs: Tab[] = [{ id: 'standings', label: 'Standings', href: `/l/${slug}`, Icon: ListOrdered }];
  if (targetRoundId) tabs.push({ id: 'round', label: 'Round', href: `/l/${slug}/r/${targetRoundId}`, Icon: Flag });
  if (showAdmin) tabs.push({ id: 'admin', label: 'Admin', href: `/l/${slug}/admin`, Icon: Settings2 });
  // …the returned <nav> is unchanged
```

`components/LeagueBar.tsx`: remove the `CommissionerTag` import; add `isCommissioner?: boolean` to `LeagueBarProps`; replace `<CommissionerTag slug={slug} />` with:

```tsx
      {isCommissioner ? (
        <span className="shrink-0 text-[15px] font-semibold leading-[22px] text-secondary">Commissioner</span>
      ) : null}
```

`app/l/[slug]/layout.tsx`: in `loadShell`, look up the viewer and return `isCommissioner`:

```ts
import { leagueAccess } from '@/lib/auth/roles';
…
type Shell = {
  league: { slug: string; name: string };
  anyLive: boolean;
  targetRoundId: string | null;
  isCommissioner: boolean;
};

async function loadShell(slug: string, now: Date): Promise<Shell | null> {
  const access = await leagueAccess(slug);
  if (!access) return null;
  const { league } = access;
  const repo = getRepo();
  const rounds = await repo.listRounds(league.id);
  // …statuses exactly as before…
  return {
    league: { slug: league.slug, name: league.name },
    anyLive: statuses.some((r) => r.status === 'live'),
    targetRoundId: targetRound(statuses, localDate(now, rounds[0]?.timezone)),
    isCommissioner: access.isCommissioner,
  };
}
```

and pass `isCommissioner={shell.isCommissioner}` to `LeagueBar` and `showAdmin={shell.isCommissioner}` to `TabBar`.

- [ ] **Step 7: Seed script uses an owner account**

`scripts/seed-demo.ts`: change the usage comment and the league/player setup (the rest — round, picks, adjustments — is unchanged):

```ts
// Creates a demo league that replays Ramp Riot 2025, with a finished draft.
// Usage: npx tsx --env-file=.env.local scripts/seed-demo.ts <owner-user-id> [site-url]
// <owner-user-id>: your id from Supabase → Authentication → Users (sign in to the app once first).
```

```ts
  const ownerId = process.argv[2];
  if (!ownerId) throw new Error('Pass your user id: scripts/seed-demo.ts <owner-user-id> [site-url]');
  const origin = (process.argv[3] ?? 'http://localhost:3000').replace(/\/+$/, '');
  const repo = createSupabaseRepo(createSupabaseClient());
  const owner = await repo.getProfile(ownerId);
  if (!owner) throw new Error(`No profile for ${ownerId}. Sign in to the app once, then re-run.`);
  …
  const league = await repo.createLeague({
    slug: makeSlug('Demo Fam'),
    name: 'Demo Fam',
    defaultScoring: defaultScoring(),
    createdBy: owner.id,
  });

  const players = [
    await repo.createMember({ leagueId: league.id, userId: owner.id, name: owner.displayName, role: 'commissioner' }),
  ];
  // Name-only rows stand in for family members (they show as "left" until real people join).
  for (const name of ['Mom', 'Dad', 'A Very Long Player Name To Test Wrapping']) {
    players.push(await repo.createPlayer(league.id, name));
  }
```

and at the end replace the admin-link line with `console.log(\`Invite code: ${league.inviteCode}\`);`. Imports: drop `generateAdminToken`, `hashToken` and `adminLink`; keep `makeSlug`.

- [ ] **Step 8: Run everything**

Run: `npm run typecheck && npm test && grep -rn "x-commissioner-key\|generateAdminToken\|verifyToken\|CommissionerTag\|storageKey\|tokenFromHash" app components lib scripts tests`
Expected: typecheck clean; tests pass; the grep prints nothing.

- [ ] **Step 9: Commit**

```bash
git add -A lib/auth lib/admin components app/l scripts tests
git commit -m "feat(auth): remove admin-token code; admin pages and tabs use the session"
```

---

### Task 10: Join with an invite code, rename yourself, leave

**Files:**
- Create: `lib/leagues/invites.ts`, `app/api/invites/[code]/route.ts`, `app/api/invites/[code]/join/route.ts`, `app/api/l/[slug]/me/route.ts`, `app/api/l/[slug]/me/leave/route.ts`
- Test: `tests/api/join.test.ts`, `tests/api/me.test.ts`

**Interfaces:**
- Consumes: `normalizeInviteCode`, `uniqueName`, `nameSchema` (Task 3); `MAX_PLAYERS`, `assertKeepsCommissioner`, `removeMember` (Task 7); `getUser`, `requireUser` (Task 5); `requireLeagueRole` (Task 5).
- Produces:
  - `GET /api/invites/{code}` (anyone) → 200 `InvitePreview = { slug: string; name: string; commissioner: string | null; memberCount: number; full: boolean; alreadyMember: boolean }`; uniform 404 `"That invite code doesn't work — check with your commissioner."`
  - `POST /api/invites/{code}/join` (signed in) → 201 `{ slug }` (joined) or 200 `{ slug, alreadyMember: true }`; 409 `"League is full"`.
  - `PATCH /api/l/{slug}/me` (member) body `{ name }` → 200 `{ player: { id, name } }`; 409 on a taken name.
  - `POST /api/l/{slug}/me/leave` (member) → 200 `{ result: 'deleted' | 'unlinked' }`; 409 last commissioner.
  - Type `InvitePreview` exported from `lib/api/types.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/api/join.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { POST as join } from '@/app/api/invites/[code]/join/route';
import { GET as preview } from '@/app/api/invites/[code]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { makeUser, setUser } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo, { signIn: false }));
  setUser(null);
});

const code = () => params({ code: league.inviteCode.toLowerCase() }); // codes match case-insensitively

describe('GET /api/invites/{code}', () => {
  it('previews the league for anyone', async () => {
    const res = await preview(request('GET', '/x'), code());
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      slug: league.slug, name: 'Habich Fam', commissioner: 'Commish', memberCount: 1, full: false, alreadyMember: false,
    });
  });
  it('answers the same 404 for junk and for unknown codes', async () => {
    const a = await preview(request('GET', '/x'), params({ code: 'nope!' }));
    const b = await preview(request('GET', '/x'), params({ code: 'ZZZZZZ' }));
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await readJson(a)).toEqual(await readJson(b));
  });
});

describe('POST /api/invites/{code}/join (spec §4.3)', () => {
  it('answers 401 signed out', async () => {
    expect((await join(request('POST', '/x'), code())).status).toBe(401);
  });

  it('joins with the profile name', async () => {
    const mom = await makeUser(repo, 'Mom');
    setUser(mom);
    const res = await join(request('POST', '/x'), code());
    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ slug: league.slug });
    expect(await repo.getMemberByUser(league.id, mom.id)).toMatchObject({ name: 'Mom', role: 'player' });
  });

  it('suffixes a colliding name: Mom, Mom 2', async () => {
    setUser(await makeUser(repo, 'Mom'));
    await join(request('POST', '/x'), code());
    const second = await makeUser(repo, 'mom');
    setUser(second);
    await join(request('POST', '/x'), code());
    expect((await repo.getMemberByUser(league.id, second.id))!.name).toBe('mom 2');
  });

  it('is a no-op for someone already in the league', async () => {
    const mom = await makeUser(repo, 'Mom');
    setUser(mom);
    await join(request('POST', '/x'), code());
    const again = await join(request('POST', '/x'), code());
    expect(again.status).toBe(200);
    expect(await readJson(again)).toEqual({ slug: league.slug, alreadyMember: true });
    expect(await repo.listPlayers(league.id)).toHaveLength(2);
  });

  it('refuses the 31st player, counting unlinked rows', async () => {
    for (let i = 0; i < 29; i++) await repo.createPlayer(league.id, `Old ${i}`); // + Commish = 30
    setUser(await makeUser(repo, 'Late'));
    const res = await join(request('POST', '/x'), code());
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('League is full');
    const p = await readJson(await preview(request('GET', '/x'), code()));
    expect(p.full).toBe(true);
  });

  it('answers 404 for an unknown code', async () => {
    setUser(await makeUser(repo, 'Mom'));
    expect((await join(request('POST', '/x'), params({ code: 'ZZZZZZ' }))).status).toBe(404);
  });
});
```

`tests/api/me.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { POST as leave } from '@/app/api/l/[slug]/me/leave/route';
import { PATCH as renameMe } from '@/app/api/l/[slug]/me/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { LAST_COMMISSIONER_MESSAGE } from '@/lib/leagues/membership';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
const here = () => params({ slug: league.slug });

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
});

describe('PATCH /api/l/{slug}/me (rename myself)', () => {
  it('renames the signed-in member only', async () => {
    const { player } = await signInAsMember(repo, league, 'Mom');
    const res = await renameMe(request('PATCH', '/x', { body: { name: ' Mother ' } }), here());
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ player: { id: player.id, name: 'Mother' } });
  });
  it('answers 409 for a name someone else has', async () => {
    await signInAsMember(repo, league, 'Mom');
    const res = await renameMe(request('PATCH', '/x', { body: { name: 'commish' } }), here());
    expect(res.status).toBe(409);
  });
  it('answers 401 signed out and 403 for a non-member', async () => {
    setUser(null);
    expect((await renameMe(request('PATCH', '/x', { body: { name: 'X' } }), here())).status).toBe(401);
    const other = await seedLeague(repo, { slug: 'other-bbbbbb' }); // signed in as other's commissioner
    expect((await renameMe(request('PATCH', '/x', { body: { name: 'X' } }), here())).status).toBe(403);
    expect(other.league.id).not.toBe(league.id);
  });
});

describe('POST /api/l/{slug}/me/leave', () => {
  it('deletes a member with no history', async () => {
    const { player } = await signInAsMember(repo, league, 'Mom');
    const res = await leave(request('POST', '/x'), here());
    expect(await readJson(res)).toEqual({ result: 'deleted' });
    expect((await repo.listPlayers(league.id)).some((p) => p.id === player.id)).toBe(false);
  });
  it('unlinks a member with picks', async () => {
    const { player } = await signInAsMember(repo, league, 'Mom');
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
      endDate: '2025-10-25', timezone: 'America/New_York', scoring: league.defaultScoring,
    });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: player.id, teamKey: 'frc341' });
    expect(await readJson(await leave(request('POST', '/x'), here()))).toEqual({ result: 'unlinked' });
  });
  it('refuses to let the last commissioner leave', async () => {
    const res = await leave(request('POST', '/x'), here()); // signed in as Commish
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe(LAST_COMMISSIONER_MESSAGE);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/api/join.test.ts tests/api/me.test.ts`
Expected: FAIL — route modules don't exist.

- [ ] **Step 3: Implement**

`lib/api/types.ts` — add:

```ts
/** GET /api/invites/{code}: what the /join page shows before joining (spec §4.6). */
export type InvitePreview = {
  slug: string;
  name: string;
  /** The first commissioner who still has an account. */
  commissioner: string | null;
  memberCount: number;
  full: boolean;
  alreadyMember: boolean;
};
```

`lib/leagues/invites.ts` (shared by both invite routes; Next.js route files may only export handlers and config):

```ts
import { HttpError } from '@/lib/api/http';
import type { InvitePreview } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import type { LeagueRow } from '@/lib/db/types';
import { normalizeInviteCode } from '@/lib/leagues/inviteCode';
import { MAX_PLAYERS } from '@/lib/leagues/membership';

export const BAD_CODE_MESSAGE = "That invite code doesn't work — check with your commissioner.";

/** Uniform 404 for junk and unknown codes (spec §4.4, §4.8). */
export async function leagueForCode(raw: string): Promise<LeagueRow> {
  const code = normalizeInviteCode(raw);
  const league = code ? await getRepo().getLeagueByInviteCode(code) : null;
  if (!league) throw new HttpError(404, BAD_CODE_MESSAGE);
  return league;
}

/** What /join shows before joining (spec §4.6). Used by the API route and the /join page. */
export async function buildInvitePreview(league: LeagueRow, userId: string | null): Promise<InvitePreview> {
  const players = await getRepo().listPlayers(league.id);
  return {
    slug: league.slug,
    name: league.name,
    commissioner: players.find((p) => p.role === 'commissioner' && p.userId !== null)?.name ?? null,
    memberCount: players.filter((p) => p.userId !== null).length,
    full: players.length >= MAX_PLAYERS,
    alreadyMember: userId !== null && players.some((p) => p.userId === userId),
  };
}
```

`app/api/invites/[code]/route.ts`:

```ts
import { handle, json } from '@/lib/api/http';
import { getUser } from '@/lib/auth/session';
import { buildInvitePreview, leagueForCode } from '@/lib/leagues/invites';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { code } = await ctx.params;
    const league = await leagueForCode(code);
    const user = await getUser();
    return json(await buildInvitePreview(league, user?.id ?? null));
  });
}
```

`app/api/invites/[code]/join/route.ts`:

```ts
import { handle, HttpError, json } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { UniqueViolation } from '@/lib/db/repo';
import { MAX_PLAYERS } from '@/lib/leagues/membership';
import { uniqueName } from '@/lib/leagues/names';
import { leagueForCode } from '@/lib/leagues/invites';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/** Instant join (spec §2, §4.3): name = display name, suffixed " 2", " 3", … on a clash. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { code } = await ctx.params;
    const user = await requireUser();
    const league = await leagueForCode(code);
    const repo = getRepo();

    if (await repo.getMemberByUser(league.id, user.id)) return json({ slug: league.slug, alreadyMember: true });
    const base = (await repo.getProfile(user.id))?.displayName ?? 'Player';

    for (let attempt = 0; attempt < 3; attempt++) {
      const players = await repo.listPlayers(league.id);
      if (players.length >= MAX_PLAYERS) throw new HttpError(409, 'League is full');
      try {
        await repo.createMember({
          leagueId: league.id,
          userId: user.id,
          name: uniqueName(base, players.map((p) => p.name)),
          role: 'player',
        });
        return json({ slug: league.slug }, 201);
      } catch (err) {
        // Someone took the same name a moment ago: recompute the suffix and try again.
        if (err instanceof UniqueViolation && err.constraint === 'players_league_name_ci') continue;
        if (err instanceof UniqueViolation && err.constraint === 'players_league_user') {
          return json({ slug: league.slug, alreadyMember: true });
        }
        throw err;
      }
    }
    throw new HttpError(409, 'Could not pick a unique name. Try again.');
  });
}
```

`app/api/l/[slug]/me/route.ts`:

```ts
import { z } from 'zod';
import { handle, json, parseBody } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { nameSchema } from '@/lib/leagues/names';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

const bodySchema = z.object({ name: nameSchema });

/** A member renames themselves in this league (spec §4.3). A clash → 409 from the unique index. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { player } = await requireLeagueRole(slug, 'player');
    const { name } = await parseBody(req, bodySchema);
    const saved = await getRepo().updatePlayer(player.id, { name });
    return json({ player: { id: saved.id, name: saved.name } });
  });
}
```

`app/api/l/[slug]/me/leave/route.ts`:

```ts
import { handle, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { assertKeepsCommissioner, removeMember } from '@/lib/leagues/membership';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** Leave a league (spec §4.3): delete-or-unlink; the last commissioner can't leave. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const repo = getRepo();
    assertKeepsCommissioner(await repo.listPlayers(league.id), player);
    return json({ result: await removeMember(repo, player) });
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api/join.test.ts tests/api/me.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/leagues/invites.ts app/api/invites "app/api/l/[slug]/me" lib/api/types.ts tests/api/join.test.ts tests/api/me.test.ts
git commit -m "feat(leagues): invite preview, instant join, rename self, leave"
```

---

### Task 11: OAuth callback, sign-out, profiles on first sign-in, session refresh (`proxy.ts`)

**Files:**
- Create: `lib/auth/profile.ts`, `app/auth/callback/route.ts`, `app/auth/signout/route.ts`, `lib/supabase/proxy.ts`, `proxy.ts`
- Test: `tests/auth/profile.test.ts`, `tests/auth/callback.test.ts`

**Interfaces:**
- Consumes: `safeNext` (Task 1), `createServerSupabase` (Task 1), repo `createProfile` (Task 4).
- Produces: `displayNameFromMetadata(meta: unknown): string`, `avatarFromMetadata(meta: unknown): string | null`, `ensureProfile(repo: Repo, user: { id: string; user_metadata?: unknown }): Promise<ProfileRow>`; `GET /auth/callback?code=…&next=…`; `POST /auth/signout` (303 → `/`); `updateSession(request: NextRequest): Promise<NextResponse>`.

- [ ] **Step 1: Write the failing tests**

`tests/auth/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { avatarFromMetadata, displayNameFromMetadata, ensureProfile } from '@/lib/auth/profile';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('displayNameFromMetadata (spec §4.2)', () => {
  it('prefers full_name, then name, then user_name', () => {
    expect(displayNameFromMetadata({ full_name: ' Joey Habich ', name: 'x', user_name: 'y' })).toBe('Joey Habich');
    expect(displayNameFromMetadata({ name: 'joey', user_name: 'y' })).toBe('joey');
    expect(displayNameFromMetadata({ user_name: 'joey5181' })).toBe('joey5181');
  });
  it('cuts to 40 characters and falls back to "Player"', () => {
    expect(displayNameFromMetadata({ full_name: 'x'.repeat(60) })).toBe('x'.repeat(40));
    for (const meta of [null, undefined, {}, { full_name: '   ' }, { full_name: 42 }, 'nope']) {
      expect(displayNameFromMetadata(meta), JSON.stringify(meta)).toBe('Player');
    }
  });
  it('strips control characters rather than rejecting the name', () => {
    expect(displayNameFromMetadata({ full_name: 'Jo\u0000ey' })).toBe('Joey');
  });
});

describe('avatarFromMetadata', () => {
  it('takes an https avatar_url or picture, nothing else', () => {
    expect(avatarFromMetadata({ avatar_url: 'https://cdn.discordapp.com/a.png' })).toBe('https://cdn.discordapp.com/a.png');
    expect(avatarFromMetadata({ picture: 'https://lh3.googleusercontent.com/p' })).toBe('https://lh3.googleusercontent.com/p');
    expect(avatarFromMetadata({ avatar_url: 'javascript:alert(1)' })).toBeNull();
    expect(avatarFromMetadata({})).toBeNull();
  });
});

describe('ensureProfile', () => {
  it('creates the profile on first sign-in and leaves it alone afterwards', async () => {
    const repo = createMemoryRepo();
    const first = await ensureProfile(repo, { id: 'u1', user_metadata: { full_name: 'Joey' } });
    expect(first.displayName).toBe('Joey');
    await repo.updateProfile('u1', { displayName: 'Joey H' });
    const second = await ensureProfile(repo, { id: 'u1', user_metadata: { full_name: 'Joey' } });
    expect(second.displayName).toBe('Joey H');
  });
});
```

`tests/auth/callback.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  exchange: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { exchangeCodeForSession: h.exchange } }),
}));

import { GET as callback } from '@/app/auth/callback/route';
import type { Repo } from '@/lib/db/repo';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.exchange.mockReset();
  h.exchange.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { full_name: 'Joey' } } }, error: null });
});

const call = (qs: string) => callback(new Request(`https://frc.example/auth/callback${qs}`));

describe('GET /auth/callback (spec §4.1)', () => {
  it('exchanges the code, creates the profile, and goes to next', async () => {
    const res = await call('?code=abc&next=%2Fjoin%2FABC234');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://frc.example/join/ABC234');
    expect(h.exchange).toHaveBeenCalledWith('abc');
    expect((await repo.getProfile('u1'))!.displayName).toBe('Joey');
  });
  it('never redirects off-site', async () => {
    for (const next of ['%2F%2Fevil.com', 'https%3A%2F%2Fevil.com', '%2F%5Cevil.com']) {
      const res = await call(`?code=abc&next=${next}`);
      expect(res.headers.get('location'), next).toBe('https://frc.example/');
    }
  });
  it('sends provider errors, missing codes and failed exchanges to /?auth_error=1', async () => {
    expect((await call('?error=access_denied')).headers.get('location')).toBe('https://frc.example/?auth_error=1');
    expect((await call('')).headers.get('location')).toBe('https://frc.example/?auth_error=1');
    h.exchange.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad code' } });
    expect((await call('?code=bad')).headers.get('location')).toBe('https://frc.example/?auth_error=1');
    expect(await repo.getProfile('u1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/auth/profile.test.ts tests/auth/callback.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`lib/auth/profile.ts`:

```ts
import type { Repo } from '@/lib/db/repo';
import type { ProfileRow } from '@/lib/db/types';
import { NAME_MAX } from '@/lib/leagues/names';

type Meta = Record<string, unknown>;
const asMeta = (m: unknown): Meta => (typeof m === 'object' && m !== null ? (m as Meta) : {});

/** Spec §4.2: full_name → name → user_name, trimmed, cut to 40 chars; fallback "Player". */
export function displayNameFromMetadata(meta: unknown): string {
  const m = asMeta(meta);
  for (const key of ['full_name', 'name', 'user_name']) {
    const v = m[key];
    if (typeof v !== 'string') continue;
    const name = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX).trim();
    if (name) return name;
  }
  return 'Player';
}

export function avatarFromMetadata(meta: unknown): string | null {
  const m = asMeta(meta);
  for (const key of ['avatar_url', 'picture']) {
    const v = m[key];
    if (typeof v === 'string' && v.startsWith('https://') && v.length <= 2000) return v;
  }
  return null;
}

/** Called after every successful sign-in; only the first one creates the row. */
export function ensureProfile(repo: Repo, user: { id: string; user_metadata?: unknown }): Promise<ProfileRow> {
  return repo.createProfile({
    id: user.id,
    displayName: displayNameFromMetadata(user.user_metadata),
    avatarUrl: avatarFromMetadata(user.user_metadata),
  });
}
```

`app/auth/callback/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { ensureProfile } from '@/lib/auth/profile';
import { safeNext } from '@/lib/auth/next';
import { getRepo } from '@/lib/db';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** OAuth lands here (spec §4.1): code → session cookie → profile → `next`. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fail = NextResponse.redirect(new URL('/?auth_error=1', url.origin));
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.has('error')) return fail;

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return fail;
    await ensureProfile(getRepo(), data.user);
  } catch (err) {
    console.error(err);
    return fail;
  }
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next')), url.origin));
}
```

`app/auth/signout/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), 303);
}
```

`lib/supabase/proxy.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAuthEnv } from '@/lib/supabase/server';

/**
 * Refreshes the Supabase session cookie on every request (spec §4.1). It never redirects:
 * pages and routes decide what signed-out visitors see.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseAuthEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  // Nothing may run between creating the client and this call (Supabase's SSR guidance).
  await supabase.auth.getClaims();
  return response;
}
```

`proxy.ts` (repo root; Next.js 16's name for middleware):

```ts
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static files and images.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/auth && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual check (needs Task 20's OAuth setup; skip until then and do it in Task 20 Step 5)**

With `npm run dev`, open `http://localhost:3000`, click **Continue with Google**, finish Google's screen → you land back on `/` signed in, and Supabase → Table Editor → `profiles` has your row.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/profile.ts app/auth lib/supabase/proxy.ts proxy.ts tests/auth/profile.test.ts tests/auth/callback.test.ts
git commit -m "feat(auth): OAuth callback with profile creation, sign-out, session refresh proxy"
```

---

### Task 12: Account settings API, delete account, E2E test sign-in

**Files:**
- Create: `lib/account/deleteAccount.ts`, `app/api/me/route.ts`, `app/api/me/profile/route.ts`, `lib/auth/testLogin.ts`, `app/api/test/login/route.ts`
- Test: `tests/account/deleteAccount.test.ts`, `tests/api/profile.test.ts`, `tests/auth/testLogin.test.ts`

**Interfaces:**
- Consumes: `assertKeepsCommissioner`, `removeMember` (Task 7); `ensureProfile` (Task 11); `safeEqual` (`lib/auth/commissioner.ts`); `createSupabaseClient` (`lib/db/supabaseRepo.ts`); `createServerSupabase` (Task 1).
- Produces: `deleteAccount(repo: Repo, userId: string): Promise<void>` (409 `"You're the only commissioner of {league}. Make someone else commissioner first."`); `PATCH /api/me/profile` body `{ displayName?: string; frcTeam?: number | null }` → 200 `{ profile }`; `DELETE /api/me` → 204; `testLoginAllowed(req: Request, env: { E2E_AUTH_SECRET?: string; VERCEL?: string }): boolean`; `POST /api/test/login` body `{ email: string; name?: string }` → 200 `{ userId }` or 404.

- [ ] **Step 1: Write the failing tests**

`tests/account/deleteAccount.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deleteAccount } from '@/lib/account/deleteAccount';
import { defaultScoring } from '@/lib/scoring/config';
import { createMemoryRepo } from '../helpers/memoryRepo';

async function setup() {
  const repo = createMemoryRepo();
  for (const [id, name] of [['u-joey', 'Joey'], ['u-mom', 'Mom']]) {
    await repo.createProfile({ id, displayName: name, avatarUrl: null });
  }
  const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring(), createdBy: 'u-joey' });
  const joey = await repo.createMember({ leagueId: league.id, userId: 'u-joey', name: 'Joey', role: 'commissioner' });
  return { repo, league, joey };
}

describe('deleteAccount (spec §4.2)', () => {
  it("is blocked while I'm the only commissioner of a league with other members", async () => {
    const { repo, league } = await setup();
    await repo.createMember({ leagueId: league.id, userId: 'u-mom', name: 'Mom', role: 'player' });
    await expect(deleteAccount(repo, 'u-joey')).rejects.toMatchObject({
      status: 409,
      message: "You're the only commissioner of Fam. Make someone else commissioner first.",
    });
    expect(await repo.getProfile('u-joey')).not.toBeNull();
  });

  it('deletes leagues where I was the only member, then the user', async () => {
    const { repo } = await setup();
    await deleteAccount(repo, 'u-joey');
    expect(await repo.getLeagueBySlug('fam-abc234')).toBeNull();
    expect(await repo.getProfile('u-joey')).toBeNull();
  });

  it('unlinks me where I have history and someone else is commissioner', async () => {
    const { repo, league, joey } = await setup();
    await repo.createMember({ leagueId: league.id, userId: 'u-mom', name: 'Mom', role: 'commissioner' });
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
      endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc341' });
    await deleteAccount(repo, 'u-joey');
    const kept = (await repo.listPlayers(league.id)).find((p) => p.id === joey.id)!;
    expect(kept).toMatchObject({ name: 'Joey', userId: null });
  });
});
```

`tests/api/profile.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth: { signOut: async () => ({}) } }) }));

import { DELETE as deleteMe } from '@/app/api/me/route';
import { PATCH as patchProfile } from '@/app/api/me/profile/route';
import type { Repo } from '@/lib/db/repo';
import { makeUser, setUser } from '../helpers/auth';
import { readJson, request } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  setUser(null);
});

describe('PATCH /api/me/profile', () => {
  it('updates display name and FRC team; null clears the team', async () => {
    const me = await makeUser(repo, 'Joey');
    setUser(me);
    const res = await patchProfile(request('PATCH', '/x', { body: { displayName: ' Joey H ', frcTeam: 5181 } }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).profile).toMatchObject({ displayName: 'Joey H', frcTeam: 5181 });
    const cleared = await patchProfile(request('PATCH', '/x', { body: { frcTeam: null } }));
    expect((await readJson(cleared)).profile.frcTeam).toBeNull();
  });
  it('validates', async () => {
    setUser(await makeUser(repo, 'Joey'));
    for (const body of [{}, { displayName: '' }, { frcTeam: 0 }, { frcTeam: 100000 }, { frcTeam: 1.5 }]) {
      expect((await patchProfile(request('PATCH', '/x', { body }))).status, JSON.stringify(body)).toBe(400);
    }
  });
  it('answers 401 signed out', async () => {
    expect((await patchProfile(request('PATCH', '/x', { body: { frcTeam: 1 } }))).status).toBe(401);
  });
});

describe('DELETE /api/me', () => {
  it('deletes the account and answers 204', async () => {
    const me = await makeUser(repo, 'Joey');
    setUser(me);
    expect((await deleteMe(request('DELETE', '/x'))).status).toBe(204);
    expect(await repo.getProfile(me.id)).toBeNull();
  });
});
```

`tests/auth/testLogin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as testLogin } from '@/app/api/test/login/route';
import { testLoginAllowed } from '@/lib/auth/testLogin';

const req = (auth?: string) =>
  new Request('http://localhost/api/test/login', {
    method: 'POST',
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.com' }),
  });

afterEach(() => vi.unstubAllEnvs());

describe('testLoginAllowed (spec §8.1)', () => {
  const secret = 's'.repeat(32);
  it('needs the secret, the matching bearer, and no VERCEL', () => {
    expect(testLoginAllowed(req(`Bearer ${secret}`), { E2E_AUTH_SECRET: secret })).toBe(true);
    expect(testLoginAllowed(req(`Bearer ${secret}`), { E2E_AUTH_SECRET: secret, VERCEL: '1' })).toBe(false);
    expect(testLoginAllowed(req(`Bearer ${secret}`), {})).toBe(false);
    expect(testLoginAllowed(req(`Bearer ${secret}`), { E2E_AUTH_SECRET: '' })).toBe(false);
    expect(testLoginAllowed(req('Bearer wrong'), { E2E_AUTH_SECRET: secret })).toBe(false);
    expect(testLoginAllowed(req(), { E2E_AUTH_SECRET: secret })).toBe(false);
  });
});

describe('POST /api/test/login', () => {
  it('is a plain 404 when not allowed (no secret configured)', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', '');
    const res = await testLogin(req('Bearer x'));
    expect(res.status).toBe(404);
  });
  it('is a 404 on Vercel even with the right secret', async () => {
    vi.stubEnv('E2E_AUTH_SECRET', 'k'.repeat(32));
    vi.stubEnv('VERCEL', '1');
    expect((await testLogin(req(`Bearer ${'k'.repeat(32)}`))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/account tests/api/profile.test.ts tests/auth/testLogin.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`lib/account/deleteAccount.ts`:

```ts
import { HttpError } from '@/lib/api/http';
import type { Repo } from '@/lib/db/repo';
import { removeMember } from '@/lib/leagues/membership';

/**
 * Delete account (spec §4.2). Checks every league first so nothing changes when it's blocked:
 * blocked while I'm the only linked commissioner of a league with other linked members.
 * Then: leagues where I'm the only linked member are deleted; elsewhere my row is deleted or
 * unlinked (spec §4.3); finally the auth user is deleted (the profile cascades).
 */
export async function deleteAccount(repo: Repo, userId: string): Promise<void> {
  const memberships = await repo.listLeaguesForUser(userId);
  const plans: { leagueId: string; alone: boolean; player: (typeof memberships)[number]['player'] }[] = [];

  for (const { league, player } of memberships) {
    const players = await repo.listPlayers(league.id);
    const others = players.filter((p) => p.id !== player.id && p.userId !== null);
    const otherCommissioners = others.filter((p) => p.role === 'commissioner');
    if (others.length > 0 && player.role === 'commissioner' && otherCommissioners.length === 0) {
      throw new HttpError(409, `You're the only commissioner of ${league.name}. Make someone else commissioner first.`);
    }
    plans.push({ leagueId: league.id, alone: others.length === 0, player });
  }

  for (const plan of plans) {
    if (plan.alone) await repo.deleteLeague(plan.leagueId);
    else await removeMember(repo, plan.player);
  }
  await repo.deleteUser(userId);
}
```

`app/api/me/profile/route.ts`:

```ts
import { z } from 'zod';
import { handle, json, parseBody } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { nameSchema } from '@/lib/leagues/names';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .strictObject({
    displayName: nameSchema.optional(),
    frcTeam: z
      .number('FRC team must be a number')
      .int('FRC team must be a whole number')
      .min(1, 'FRC team must be between 1 and 99999')
      .max(99999, 'FRC team must be between 1 and 99999')
      .nullable()
      .optional(),
  })
  .refine((v) => v.displayName !== undefined || v.frcTeam !== undefined, { message: 'Nothing to change' });

/** /me/settings (spec §4.2). Changing the display name doesn't rename you inside existing leagues. */
export async function PATCH(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const patch = await parseBody(req, bodySchema);
    const profile = await getRepo().updateProfile(user.id, patch);
    return json({ profile });
  });
}
```

`app/api/me/route.ts`:

```ts
import { handle, noContent } from '@/lib/api/http';
import { deleteAccount } from '@/lib/account/deleteAccount';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    await deleteAccount(getRepo(), user.id);
    try {
      await (await createServerSupabase()).auth.signOut(); // clear the cookie; the user is already gone
    } catch {
      // Nothing to do: the next request simply has no valid session.
    }
    return noContent();
  });
}
```

`lib/auth/testLogin.ts`:

```ts
import { safeEqual } from '@/lib/auth/commissioner';

/** Spec §8.1: only with a secret configured, the matching bearer, and never on any Vercel deploy. */
export function testLoginAllowed(req: Request, env: { E2E_AUTH_SECRET?: string; VERCEL?: string }): boolean {
  const secret = env.E2E_AUTH_SECRET;
  if (!secret || env.VERCEL) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return token !== '' && safeEqual(token, secret);
}
```

`app/api/test/login/route.ts`:

```ts
import { z } from 'zod';
import { handle, json, jsonError, parseBody } from '@/lib/api/http';
import { ensureProfile } from '@/lib/auth/profile';
import { testLoginAllowed } from '@/lib/auth/testLogin';
import { getRepo } from '@/lib/db';
import { createSupabaseClient } from '@/lib/db/supabaseRepo';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ email: z.email(), name: z.string().max(40).optional() });

/**
 * E2E only (spec §8.1, §9): signs a Playwright browser in as a Supabase admin-created user,
 * without Google or Discord. 404 everywhere else.
 */
export async function POST(req: Request): Promise<Response> {
  if (!testLoginAllowed(req, { E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET, VERCEL: process.env.VERCEL })) {
    return jsonError(404, 'Not found');
  }
  return handle(async () => {
    const { email, name } = await parseBody(req, bodySchema);
    const admin = createSupabaseClient().auth.admin;
    // Creating an existing user fails harmlessly; generateLink works either way.
    await admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name ?? email.split('@')[0] } });
    const { data, error } = await admin.generateLink({ type: 'magiclink', email });
    if (error || !data.properties?.hashed_token) throw new Error(error?.message ?? 'No magic link token');

    const supabase = await createServerSupabase(); // sets the session cookies on this response
    const verified = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token });
    if (verified.error || !verified.data.user) throw new Error(verified.error?.message ?? 'verifyOtp failed');
    await ensureProfile(getRepo(), verified.data.user);
    return json({ userId: verified.data.user.id });
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/account tests/api/profile.test.ts tests/auth && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/account app/api/me lib/auth/testLogin.ts app/api/test tests/account tests/api/profile.test.ts tests/auth/testLogin.test.ts
git commit -m "feat(account): profile settings, delete account, E2E-only test sign-in"
```

---
## Batch C — screens

All screens follow `design-system/frc-fantasy/` (dark-first, bumper plates, scoreboard cards) and reuse `components/ui/*` (`Card`, `Button`, `Input`, `Alert`, `Badge`, `BumperPlate`). Check each at 360 px in both themes before committing (`npm run dev`, browser devtools → 360 × 740, toggle the theme button).

### Task 13: App shell — header account button and the Me | Leagues tab bar

**Files:**
- Modify: `lib/nav.ts`, `components/ui/icons.tsx` (add `UserRound`), `app/layout.tsx`
- Create: `components/AppTabBar.tsx`, `components/HeaderAccount.tsx`
- Test: `tests/ui/shell.test.ts`

**Interfaces:**
- Consumes: `getUser` (Task 5), repo `getProfile` (Task 4).
- Produces: `appTab(pathname: string): 'me' | 'leagues' | null`, `showAppTabBar(pathname: string): boolean` (false on `/l/*` — deviation 1); `AppTabBarView({ pathname })`, `AppTabBar()`; `HeaderAccountView({ user, pathname })`, `HeaderAccount({ user })` where `user: { displayName: string; avatarUrl: string | null } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/shell.test.ts` (it already imports `h`, `render`, `describe`, `expect`, `it`):

```ts
import { AppTabBarView } from '@/components/AppTabBar';
import { HeaderAccountView } from '@/components/HeaderAccount';
import { appTab, showAppTabBar } from '@/lib/nav';

describe('appTab / showAppTabBar (spec §4.6)', () => {
  it('maps paths to the Me and Leagues tabs', () => {
    expect(appTab('/')).toBe('me');
    expect(appTab('/me/settings')).toBe('me');
    expect(appTab('/leagues')).toBe('leagues');
    expect(appTab('/leagues/new')).toBe('leagues');
    expect(appTab('/join/ABC234')).toBe('leagues');
    expect(appTab('/l/fam-abc234')).toBeNull();
  });
  it('hides the app bar on league pages, which have their own bottom bar', () => {
    expect(showAppTabBar('/')).toBe(true);
    expect(showAppTabBar('/leagues')).toBe(true);
    expect(showAppTabBar('/l/fam-abc234')).toBe(false);
    expect(showAppTabBar('/l/fam-abc234/admin')).toBe(false);
  });
});

describe('AppTabBarView', () => {
  it('renders Me and Leagues with the active one marked', () => {
    const html = render(h(AppTabBarView, { pathname: '/leagues' }));
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/leagues"');
    expect(html).toMatch(/href="\/leagues"[^>]*aria-current="page"/);
  });
  it('renders nothing on league pages', () => {
    expect(render(h(AppTabBarView, { pathname: '/l/x' }))).toBe('');
  });
});

describe('HeaderAccountView', () => {
  it('signed out: a Sign in link that comes back to this page', () => {
    const html = render(h(HeaderAccountView, { user: null, pathname: '/join/ABC234' }));
    expect(html).toContain('Sign in');
    expect(html).toContain('href="/?next=%2Fjoin%2FABC234"');
  });
  it('signed in: an account link to settings with the initial when there is no avatar', () => {
    const html = render(h(HeaderAccountView, { user: { displayName: 'Joey', avatarUrl: null }, pathname: '/' }));
    expect(html).toContain('href="/me/settings"');
    expect(html).toContain('aria-label="Account settings for Joey"');
    expect(html).toContain('>J<');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/ui/shell.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

Append to `lib/nav.ts`:

```ts
export type AppTab = 'me' | 'leagues';

/** The signed-in app's bottom tabs (spec §4.6). null = not an app-tab page. */
export function appTab(pathname: string): AppTab | null {
  if (pathname === '/' || pathname === '/me' || pathname.startsWith('/me/')) return 'me';
  if (pathname === '/leagues' || pathname.startsWith('/leagues/') || pathname.startsWith('/join/')) return 'leagues';
  return null;
}

/** League pages keep their own bottom TabBar, so the app bar steps aside there (plan deviation 1). */
export function showAppTabBar(pathname: string): boolean {
  return !pathname.startsWith('/l/');
}
```

Append to `components/ui/icons.tsx`:

```tsx
export function UserRound(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </Icon>
  );
}
```

`components/AppTabBar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trophy, UserRound } from '@/components/ui/icons';
import { appTab, showAppTabBar } from '@/lib/nav';

const TABS = [
  { id: 'me', label: 'Me', href: '/', Icon: UserRound },
  { id: 'leagues', label: 'Leagues', href: '/leagues', Icon: Trophy },
] as const;

/** Signed-in bottom bar (spec §4.6). Same look as the league TabBar. */
export function AppTabBarView({ pathname }: { pathname: string }) {
  if (!showAppTabBar(pathname)) return null;
  const current = appTab(pathname);
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:border-t-0 md:bg-transparent md:pb-0"
    >
      <ul className="mx-auto flex max-w-2xl px-2 md:max-w-3xl md:justify-center md:gap-1">
        {TABS.map(({ id, label, href, Icon }) => {
          const active = current === id;
          return (
            <li key={id} className="flex flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex min-h-16 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl',
                  'text-[13px] font-semibold leading-[18px] motion-safe:transition-colors duration-150',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  'md:min-h-11 md:flex-row md:gap-2 md:rounded-pill md:px-4 md:text-[15px]',
                  active
                    ? 'relative text-primary before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-b-full before:bg-primary md:bg-primary-fill md:text-on-primary md:before:hidden'
                    : 'text-fg-muted hover:text-fg md:hover:bg-surface-2',
                ].join(' ')}
              >
                <Icon className="size-6 shrink-0 md:size-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppTabBar() {
  return <AppTabBarView pathname={usePathname() ?? '/'} />;
}
```

`components/HeaderAccount.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export type HeaderUser = { displayName: string; avatarUrl: string | null } | null;

export function HeaderAccountView({ user, pathname }: { user: HeaderUser; pathname: string }) {
  if (!user) {
    const next = pathname === '/' ? '/' : `/?next=${encodeURIComponent(pathname)}`;
    return (
      <Button href={next} variant="secondary" size="sm">
        Sign in
      </Button>
    );
  }
  return (
    <Link
      href="/me/settings"
      aria-label={`Account settings for ${user.displayName}`}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider avatars; no Next image config needed
        <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-fill font-display text-lg font-bold text-on-primary">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
    </Link>
  );
}

export function HeaderAccount({ user }: { user: HeaderUser }) {
  return <HeaderAccountView user={user} pathname={usePathname() ?? '/'} />;
}
```

`app/layout.tsx`: make `RootLayout` async, load the header user, and render the new pieces. Replace the `<ThemeToggle />` line with a group, add the tab bar after the content, and change the footer copy (spec §4.6):

```tsx
import { AppTabBar } from '@/components/AppTabBar';
import { HeaderAccount, type HeaderUser } from '@/components/HeaderAccount';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

async function loadHeaderUser(): Promise<HeaderUser> {
  try {
    const user = await getUser();
    if (!user) return null;
    const profile = await getRepo().getProfile(user.id);
    return { displayName: profile?.displayName ?? 'Player', avatarUrl: profile?.avatarUrl ?? null };
  } catch (err) {
    console.error(err); // a sleeping database or missing env var: render signed-out rather than a blank page
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerUser = await loadHeaderUser();
  return (
    …
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <HeaderAccount user={headerUser} />
            </div>
    …
        <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 pb-24 md:max-w-3xl md:pb-8">{children}</div>
        {headerUser ? <AppTabBar /> : null}
        <footer className="mx-auto w-full max-w-2xl px-4 pb-6 text-center md:max-w-3xl">
          <p className="text-sm text-fg-muted">
            Made by students on FRC Team 5181 ·{' '}
            <a
              href="https://www.thebluealliance.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 cursor-pointer items-center gap-1 underline-offset-4 hover:text-fg hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Data from The Blue Alliance
              <ExternalLink className="size-3.5" />
            </a>
          </p>
        </footer>
```

(Keep everything else in the layout — fonts, `THEME_BOOT_SCRIPT`, the `Mark`, `metadata`, `viewport` — as it is.)

- [ ] **Step 4: Run tests, typecheck, look at it**

Run: `npx vitest run tests/ui && npm run typecheck`
Expected: PASS. Then `npm run dev`: at 360 px, signed out, the header shows the theme toggle + "Sign in"; no bottom bar on `/`. (Signed-in checks happen after Task 20's OAuth setup, or sign in via the test route: `curl -X POST localhost:3000/api/test/login -H "Authorization: Bearer $E2E_AUTH_SECRET" -H 'content-type: application/json' -d '{"email":"joey-dev@example.com","name":"Joey"}' -c /tmp/frcf-cookies` and copy the `sb-…` cookie into the browser via devtools → Application → Cookies.)

- [ ] **Step 5: Commit**

```bash
git add lib/nav.ts components/ui/icons.tsx components/AppTabBar.tsx components/HeaderAccount.tsx app/layout.tsx tests/ui/shell.test.ts
git commit -m "feat(ui): header account button and Me | Leagues tab bar"
```

---

### Task 14: Private-league card on league and round pages

**Files:**
- Create: `components/PrivateLeague.tsx`
- Modify: `app/l/[slug]/layout.tsx`, `app/l/[slug]/page.tsx`, `app/l/[slug]/r/[roundId]/page.tsx`
- Test: `tests/ui/private.test.ts`

**Interfaces:**
- Consumes: `leagueAccess` (Task 5), `SignInButtons` (Task 9).
- Produces: `PrivateLeague({ signedIn: boolean; next: string })`.

- [ ] **Step 1: Write the failing test**

`tests/ui/private.test.ts`:

```ts
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: async () => ({ data: null, fetchedAt: null, stale: false }) }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import LeaguePage from '@/app/l/[slug]/page';
import RoundPage from '@/app/l/[slug]/r/[roundId]/page';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser } from '../helpers/auth';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo, { visibility: 'members', signIn: false }));
  await repo.createPlayer(league.id, 'SecretMom');
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
    endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  setUser(null);
});

async function html(el: Promise<ReactElement>) {
  return renderToStaticMarkup(await el);
}

describe('members-only leagues (spec §4.5)', () => {
  it('shows the private card, with no league data, to signed-out visitors', async () => {
    const out = await html(LeaguePage({ params: Promise.resolve({ slug: league.slug }) }));
    expect(out).toContain('Private league');
    expect(out).toContain('Continue with Google');
    for (const secret of ['Habich Fam', 'SecretMom', 'Commish', 'Ramp Riot']) expect(out).not.toContain(secret);
  });
  it('shows the same card to signed-in non-members on the round page', async () => {
    setUser(await makeUser(repo, 'Stranger'));
    const out = await html(RoundPage({ params: Promise.resolve({ slug: league.slug, roundId: round.id }) }));
    expect(out).toContain('Private league — ask the commissioner for an invite code');
    expect(out).not.toContain('Continue with Google');
    for (const secret of ['Habich Fam', 'SecretMom', 'Ramp Riot']) expect(out).not.toContain(secret);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/ui/private.test.ts`
Expected: FAIL — the page renders the league (or `PrivateLeague` doesn't exist).

- [ ] **Step 3: Implement**

`components/PrivateLeague.tsx`:

```tsx
import { SignInButtons } from '@/components/SignInButtons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/** Members-only league seen by a non-member (spec §4.5): explains itself, shows no data. */
export function PrivateLeague({ signedIn, next }: { signedIn: boolean; next: string }) {
  return (
    <main id="main">
      <Card title="Private league" className="space-y-4">
        <p className="text-[15px] text-fg-muted">Private league — ask the commissioner for an invite code.</p>
        {signedIn ? (
          <Button href="/leagues" variant="secondary">
            Enter an invite code
          </Button>
        ) : (
          <>
            <p className="text-[15px] text-fg-muted">Already a member? Sign in to see it.</p>
            <SignInButtons next={next} />
          </>
        )}
      </Card>
    </main>
  );
}
```

`app/l/[slug]/page.tsx` — at the top of `LeaguePage`, before `loadLeaguePage`:

```tsx
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}`} />;
```

`app/l/[slug]/r/[roundId]/page.tsx` — the same, before `loadRoundPage`, with `next={`/l/${slug}/r/${roundId}`}`.

`app/l/[slug]/layout.tsx` — `loadShell` already calls `leagueAccess` (Task 9). Return `canView` in `Shell`; when it's false, render only `{children}` (the page shows the card) and **no** `LeagueBar`/`TabBar`, so the league name never reaches the page:

```tsx
  if (!shell.canView) return children;
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/ui tests/views && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/PrivateLeague.tsx "app/l/[slug]/layout.tsx" "app/l/[slug]/page.tsx" "app/l/[slug]/r/[roundId]/page.tsx" tests/ui/private.test.ts
git commit -m "feat(leagues): private-league card for members-only leagues"
```

---

### Task 15: Leagues tab, create league, join page, account settings

**Files:**
- Create: `components/InviteCodeBox.tsx`, `components/JoinView.tsx`, `components/JoinButton.tsx`, `components/SettingsForm.tsx`, `components/SignInCard.tsx`
- Create: `app/leagues/page.tsx`, `app/leagues/new/page.tsx`, `app/join/[code]/page.tsx`, `app/me/settings/page.tsx`
- Modify: `components/CreateLeagueForm.tsx` (final shape)
- Test: `tests/ui/pages.test.ts`

**Interfaces:**
- Consumes: `getUser` (Task 5); repo `listLeaguesForUser`, `getProfile`; `leagueForCode`, `buildInvitePreview`, `BAD_CODE_MESSAGE` (Task 10); `normalizeInviteCode` (Task 3); `createLeague` client (Task 8); `SignInButtons` (Task 9).
- Produces: `InviteCodeBox()`, `JoinView({ preview: InvitePreview | null; signedIn: boolean; code: string })`, `SignInCard({ title: string; next: string })`, `CreateLeagueForm({ event?: { key: string; name: string } })`, `SettingsForm({ profile: { displayName: string; frcTeam: number | null } })`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/pages.test.ts`:

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import { CreateLeagueForm } from '@/components/CreateLeagueForm';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { JoinView } from '@/components/JoinView';
import { SettingsForm } from '@/components/SettingsForm';

const preview = {
  slug: 'habich-fam-abc234', name: 'Habich Fam', commissioner: 'Joey', memberCount: 3, full: false, alreadyMember: false,
};

describe('JoinView (spec §4.6 /join)', () => {
  it('signed out: league name and sign-in buttons that come back here', () => {
    const out = render(h(JoinView, { preview, signedIn: false, code: 'ABC234' }));
    expect(out).toContain('Habich Fam');
    expect(out).toContain('Continue with Google');
    expect(out).not.toContain('Commissioner: Joey'); // details only after sign-in
  });
  it('signed in: commissioner, member count and a Join button', () => {
    const out = render(h(JoinView, { preview, signedIn: true, code: 'ABC234' }));
    expect(out).toContain('Commissioner: Joey');
    expect(out).toContain('3 members');
    expect(out).toContain('>Join<');
  });
  it('full league and bad code messages', () => {
    expect(render(h(JoinView, { preview: { ...preview, full: true }, signedIn: true, code: 'ABC234' }))).toContain('League is full');
    expect(render(h(JoinView, { preview: null, signedIn: true, code: 'NOPE' }))).toContain(
      'That invite code doesn&#x27;t work — check with your commissioner.',
    );
  });
});

describe('CreateLeagueForm', () => {
  it('has name, the two visibility choices, and no passcode', () => {
    const out = render(h(CreateLeagueForm, {}));
    expect(out).toContain('League name');
    expect(out).toContain('Anyone with the link can view');
    expect(out).toContain('Members only');
    expect(out).not.toMatch(/passcode/i);
  });
  it('shows the prefilled first round', () => {
    const out = render(h(CreateLeagueForm, { event: { key: '2026parr', name: 'Ramp Riot 2026' } }));
    expect(out).toContain('First round: Ramp Riot 2026');
  });
});

describe('InviteCodeBox and SettingsForm', () => {
  it('renders the code input', () => {
    expect(render(h(InviteCodeBox, {}))).toContain('Have an invite code?');
  });
  it('renders the settings fields and the danger zone', () => {
    const out = render(h(SettingsForm, { profile: { displayName: 'Joey', frcTeam: 5181 } }));
    expect(out).toContain('value="Joey"');
    expect(out).toContain('value="5181"');
    expect(out).toContain('Sign out');
    expect(out).toContain('Delete account');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/ui/pages.test.ts`
Expected: FAIL — components missing.

- [ ] **Step 3: Implement the components**

`components/SignInCard.tsx`:

```tsx
import { SignInButtons } from '@/components/SignInButtons';
import { Card } from '@/components/ui/Card';

export function SignInCard({ title, next }: { title: string; next: string }) {
  return (
    <main id="main">
      <Card title={title} className="space-y-4">
        <SignInButtons next={next} />
      </Card>
    </main>
  );
}
```

`components/InviteCodeBox.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { normalizeInviteCode } from '@/lib/leagues/inviteCode';

/** "Have an invite code?" → /join/{CODE} (spec §4.6). Used on the landing page and the Leagues tab. */
export function InviteCodeBox() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalizeInviteCode(value);
        if (!code) return setError('Invite codes are 6 letters and numbers');
        router.push(`/join/${code}`);
      }}
    >
      <Input
        label="Have an invite code?"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        maxLength={12}
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="ABC234"
        error={error}
        className="flex-1"
      />
      <Button type="submit" variant="secondary">
        Go
      </Button>
    </form>
  );
}
```

`components/JoinButton.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export function JoinButton({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function join() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invites/${encodeURIComponent(code)}/join`, { method: 'POST', credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return router.push(`/l/${body.slug}`);
    setError(typeof body.error === 'string' ? body.error : 'Something went wrong');
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      <Button type="button" busy={busy} onClick={join}>
        Join
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
```

`components/JoinView.tsx`:

```tsx
import { JoinButton } from '@/components/JoinButton';
import { SignInButtons } from '@/components/SignInButtons';
import { Card } from '@/components/ui/Card';
import type { InvitePreview } from '@/lib/api/types';
import { BAD_CODE_MESSAGE } from '@/lib/leagues/inviteMessages';

/** /join/{code} (spec §4.6). Signed out: name + sign in. Signed in: details + Join. */
export function JoinView({ preview, signedIn, code }: { preview: InvitePreview | null; signedIn: boolean; code: string }) {
  if (!preview) {
    return (
      <main id="main">
        <Card title="Invite code not found">
          <p className="text-[15px] text-fg-muted">{BAD_CODE_MESSAGE}</p>
        </Card>
      </main>
    );
  }
  return (
    <main id="main">
      <Card eyebrow="You're invited to" title={preview.name} className="space-y-4">
        {!signedIn ? (
          <>
            <p className="text-[15px] text-fg-muted">Sign in to join. It takes one tap with Google or Discord.</p>
            <SignInButtons next={`/join/${code}`} />
          </>
        ) : preview.full ? (
          <p className="text-[15px] font-semibold text-red-alliance-text">League is full</p>
        ) : (
          <>
            <p className="text-[15px] text-fg-muted">
              {preview.commissioner ? `Commissioner: ${preview.commissioner} · ` : ''}
              {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
            </p>
            <JoinButton code={code} />
          </>
        )}
      </Card>
    </main>
  );
}
```

`BAD_CODE_MESSAGE` must be importable by a client-reachable component without dragging `lib/db` into the browser, so move it: create `lib/leagues/inviteMessages.ts` containing only

```ts
export const BAD_CODE_MESSAGE = "That invite code doesn't work — check with your commissioner.";
```

and in `lib/leagues/invites.ts` replace the constant with `export { BAD_CODE_MESSAGE } from '@/lib/leagues/inviteMessages';` plus `import { BAD_CODE_MESSAGE } from '@/lib/leagues/inviteMessages';` for its own use.

`components/CreateLeagueForm.tsx` (whole file):

```tsx
'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { adminFetch, createLeague } from '@/lib/admin/client';

type Visibility = 'link' | 'members';

/** /leagues/new (spec §4.6). With ?event=, the event becomes the first round. */
export function CreateLeagueForm({ event }: { event?: { key: string; name: string } }) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('link');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { slug } = await createLeague({ name, visibility });
      if (event) {
        try {
          await adminFetch(slug, '/rounds', { method: 'POST', body: { eventKey: event.key } });
        } catch {
          // The league exists; the commissioner can add the round from the dashboard.
        }
      }
      window.location.assign(`/l/${slug}/admin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  const choice = (value: Visibility, label: string, hint: string) => (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:checked]:border-primary">
      <input
        type="radio"
        name="visibility"
        value={value}
        checked={visibility === value}
        onChange={() => setVisibility(value)}
        className="mt-1 size-4 accent-[var(--color-primary)]"
      />
      <span>
        <span className="block font-semibold text-fg">{label}</span>
        <span className="block text-sm text-fg-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <Card title="Create a league" className="space-y-4">
      <form onSubmit={submit} className="space-y-4">
        <Input label="League name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-fg">Who can see it?</legend>
          {choice('link', 'Anyone with the link can view', 'Standings are public to whoever has the link. Only members play.')}
          {choice('members', 'Members only', 'Only people who joined with the invite code can see it.')}
        </fieldset>
        {event ? <p className="text-[15px] text-fg-muted">First round: {event.name}</p> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" busy={busy} disabled={name.trim() === ''}>
          Create league
        </Button>
      </form>
    </Card>
  );
}
```

`components/SettingsForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

/** /me/settings (spec §4.2): display name, "My FRC team", sign out, delete account. */
export function SettingsForm({ profile }: { profile: { displayName: string; frcTeam: number | null } }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [team, setTeam] = useState(profile.frcTeam === null ? '' : String(profile.frcTeam));
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function call(method: string, url: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong');
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMessage(null);
    try {
      await call('PATCH', '/api/me/profile', {
        displayName,
        frcTeam: team.trim() === '' ? null : Number(team),
      });
      setMessage({ tone: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your account? Your past picks stay in league history under your name. This can’t be undone.')) return;
    setBusy('delete');
    try {
      await call('DELETE', '/api/me');
      window.location.assign('/');
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : 'Something went wrong' });
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Your profile" className="space-y-4">
        <form onSubmit={save} className="space-y-4">
          <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
          <Input
            label="My FRC team (optional)"
            inputMode="numeric"
            value={team}
            onChange={(e) => setTeam(e.target.value.replace(/\D/g, ''))}
            maxLength={5}
            hint="New leagues use your display name. Rename yourself inside a league from its page."
          />
          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          <Button type="submit" busy={busy === 'save'} disabled={busy !== null}>
            Save
          </Button>
        </form>
      </Card>
      <Card title="Account" className="space-y-3">
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
        <Button type="button" variant="danger" busy={busy === 'delete'} disabled={busy !== null} onClick={deleteAccount}>
          Delete account
        </Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Implement the pages**

`app/leagues/page.tsx`:

```tsx
import Link from 'next/link';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { SignInCard } from '@/components/SignInCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LeaguesPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to see your leagues" next="/leagues" />;
  const mine = await getRepo().listLeaguesForUser(user.id);
  return (
    <main id="main" className="space-y-6">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Leagues</h1>
      <Card className="space-y-3">
        {mine.length === 0 ? <p className="text-[15px] text-fg-muted">You&apos;re not in any leagues yet.</p> : null}
        <ul className="-mx-2 divide-y divide-border">
          {mine.map(({ league, player }) => (
            <li key={league.id}>
              <Link
                href={`/l/${league.slug}`}
                className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lg px-2 hover:bg-fg/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate font-semibold text-fg">{league.name}</span>
                {player.role === 'commissioner' ? (
                  <span className="shrink-0 text-sm font-semibold text-secondary">Commissioner</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        <Button href="/leagues/new">Create league</Button>
      </Card>
      <Card>
        <InviteCodeBox />
      </Card>
    </main>
  );
}
```

`app/leagues/new/page.tsx`:

```tsx
import { CreateLeagueForm } from '@/components/CreateLeagueForm';
import { SignInCard } from '@/components/SignInCard';
import { getUser } from '@/lib/auth/session';
import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';
import { EVENT_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { searchParams: Promise<{ event?: string | string[] }> };

export default async function NewLeaguePage({ searchParams }: Props) {
  const raw = (await searchParams).event;
  const key = typeof raw === 'string' && EVENT_KEY_RE.test(raw) ? raw : null;
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to create a league" next={key ? `/leagues/new?event=${key}` : '/leagues/new'} />;

  let event: { key: string; name: string } | undefined;
  if (key) {
    const tba = await getTba<TbaEvent>(`/event/${key}`, { windowMs: DEFAULT_WINDOW_MS });
    if (tba.data?.name) event = { key, name: tba.data.name };
  }
  return (
    <main id="main">
      <CreateLeagueForm event={event} />
    </main>
  );
}
```

`app/join/[code]/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { JoinView } from '@/components/JoinView';
import { HttpError } from '@/lib/api/http';
import type { InvitePreview } from '@/lib/api/types';
import { getUser } from '@/lib/auth/session';
import { buildInvitePreview, leagueForCode } from '@/lib/leagues/invites';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const user = await getUser();
  let preview: InvitePreview | null = null;
  try {
    preview = await buildInvitePreview(await leagueForCode(code), user?.id ?? null);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
  if (preview?.alreadyMember) redirect(`/l/${preview.slug}`);
  return <JoinView preview={preview} signedIn={user !== null} code={code.trim().toUpperCase()} />;
}
```

`app/me/settings/page.tsx`:

```tsx
import { SettingsForm } from '@/components/SettingsForm';
import { SignInCard } from '@/components/SignInCard';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to change your settings" next="/me/settings" />;
  const profile = await getRepo().getProfile(user.id);
  return (
    <main id="main" className="space-y-6">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Settings</h1>
      <SettingsForm profile={{ displayName: profile?.displayName ?? 'Player', frcTeam: profile?.frcTeam ?? null }} />
    </main>
  );
}
```

- [ ] **Step 5: Run tests, typecheck, look at each page at 360 px in both themes**

Run: `npx vitest run tests/ui && npm run typecheck && npm test`
Expected: PASS. Visit `/leagues`, `/leagues/new`, `/leagues/new?event=2025parr`, `/join/ZZZZZZ`, `/me/settings` signed out and signed in (test-login cookie, Task 13 Step 4): no horizontal scroll, tap targets ≥ 44 px.

- [ ] **Step 6: Commit**

```bash
git add components/InviteCodeBox.tsx components/JoinView.tsx components/JoinButton.tsx components/SettingsForm.tsx components/SignInCard.tsx components/CreateLeagueForm.tsx lib/leagues/invites.ts lib/leagues/inviteMessages.ts app/leagues app/join app/me tests/ui/pages.test.ts
git commit -m "feat(ui): Leagues tab, create league, join page, account settings"
```

---

### Task 16: Landing page (signed-out `/`)

**Files:**
- Create: `lib/views/landing.ts`, `components/landing/Landing.tsx`, `components/landing/SampleScoreboard.tsx`
- Modify: `app/page.tsx`
- Delete: nothing (`CreateLeagueForm` now lives at `/leagues/new`)
- Test: `tests/views/landing.test.ts`, `tests/ui/landing.test.ts`

**Interfaces:**
- Consumes: `getTba`, `SignInButtons`, `InviteCodeBox`, `Leaderboard`, `BumperPlate`, `safeNext`.
- Produces: `pickUpcoming(events: TbaEvent[], today: string, n?: number): TbaEvent[]`, `loadUpcomingEvents(now: Date): Promise<TbaEvent[]>` (never throws; `[]` when TBA is unreachable), `Landing({ upcoming, authError, next })`.

- [ ] **Step 1: Write the failing tests**

`tests/views/landing.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getTba: vi.fn() }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...a: unknown[]) => h.getTba(...a) }));

import { loadUpcomingEvents, pickUpcoming } from '@/lib/views/landing';

const ev = (key: string, start: string, name = key) => ({ key, name, start_date: start, end_date: start });

describe('pickUpcoming (spec §4.6 Coming up)', () => {
  it('keeps events starting today or later, soonest first, at most 4', () => {
    const events = [ev('a', '2026-10-20'), ev('b', '2026-10-24'), ev('c', '2026-10-31'), ev('d', '2026-11-07'), ev('e', '2026-11-14'), ev('f', '2026-10-24', 'Aardvark')];
    expect(pickUpcoming(events, '2026-10-24').map((e) => e.key)).toEqual(['f', 'b', 'c', 'd']);
  });
  it('ignores rows without a usable start date', () => {
    expect(pickUpcoming([{ key: 'x', name: 'x', start_date: '', end_date: '' }], '2026-01-01')).toEqual([]);
  });
});

describe('loadUpcomingEvents', () => {
  it('returns [] when TBA is unreachable', async () => {
    h.getTba.mockResolvedValue({ data: null, fetchedAt: null, stale: true });
    expect(await loadUpcomingEvents(new Date('2026-10-01T12:00:00Z'))).toEqual([]);
  });
  it('tops up from next year late in the year', async () => {
    h.getTba.mockImplementation(async (path: string) => ({
      data: path.includes('/2026/') ? [ev('2026x', '2026-12-05')] : [ev('2027a', '2027-02-27'), ev('2027b', '2027-03-06'), ev('2027c', '2027-03-06'), ev('2027d', '2027-03-13')],
      fetchedAt: 'x', stale: false,
    }));
    const out = await loadUpcomingEvents(new Date('2026-11-20T12:00:00Z'));
    expect(out.map((e) => e.key)).toEqual(['2026x', '2027a', '2027b', '2027c']);
  });
  it('never throws', async () => {
    h.getTba.mockRejectedValue(new Error('boom'));
    expect(await loadUpcomingEvents(new Date())).toEqual([]);
  });
});
```

`tests/ui/landing.test.ts`:

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import { Landing } from '@/components/landing/Landing';

describe('Landing (spec §4.6)', () => {
  const upcoming = [{ key: '2026parr', name: 'Ramp Riot', start_date: '2026-10-24', end_date: '2026-10-24' }];
  it('has the hero, sign-in, invite box, sample scoreboard, how it works, formats, coming up', () => {
    const out = render(h(Landing, { upcoming, authError: false, next: '/' }));
    for (const text of [
      'Draft FRC teams. Watch every match. Roast your friends.',
      'Continue with Google', 'Continue with Discord', 'Have an invite code?',
      '+15 winner', 'Draft', 'Watch', 'Win', 'Event-by-event', 'Full season',
      'Coming up', 'Ramp Riot', 'href="/leagues/new?event=2026parr"',
    ]) expect(out, text).toContain(text);
  });
  it('omits Coming up when there are no events, and shows the auth error', () => {
    const out = render(h(Landing, { upcoming: [], authError: true, next: '/' }));
    expect(out).not.toContain('Coming up');
    expect(out).toContain('Sign-in didn&#x27;t finish — try again.');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/views/landing.test.ts tests/ui/landing.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`lib/views/landing.ts`:

```ts
import { localDate, MINUTE_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The next n events that start today or later (spec §4.6 "Coming up"). */
export function pickUpcoming(events: TbaEvent[], today: string, n = 4): TbaEvent[] {
  return events
    .filter((e) => DATE_RE.test(e.start_date ?? '') && e.start_date >= today && typeof e.name === 'string')
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
    .slice(0, n);
}

async function eventsFor(year: number): Promise<TbaEvent[]> {
  const res = await getTba<TbaEvent[]>(`/events/${year}/simple`, { windowMs: 10 * MINUTE_MS });
  return Array.isArray(res.data) ? res.data : [];
}

/** Never throws: if TBA is unreachable the landing page just omits the block. */
export async function loadUpcomingEvents(now: Date): Promise<TbaEvent[]> {
  try {
    const today = localDate(now, 'America/New_York');
    const year = Number(today.slice(0, 4));
    let picked = pickUpcoming(await eventsFor(year), today);
    if (picked.length < 4) picked = pickUpcoming([...picked, ...(await eventsFor(year + 1))], today);
    return picked;
  } catch (err) {
    console.error(err);
    return [];
  }
}
```

`components/landing/SampleScoreboard.tsx`:

```tsx
import { Leaderboard } from '@/components/Leaderboard';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Card } from '@/components/ui/Card';

// Static demo (spec §4.6): explains scoring by showing it. Numbers are illustrative.
const ROWS = [
  { id: 'a', rank: 1, name: 'Mom', total: 184 },
  { id: 'b', rank: 2, name: 'Joey', total: 171 },
  { id: 'c', rank: 3, name: 'Dad', total: 142 },
  { id: 'd', rank: 4, name: 'Grandpa', total: 97 },
];

export function SampleScoreboard() {
  return (
    <Card eyebrow="Sample league" title="Ramp Riot standings" className="space-y-3">
      <Leaderboard rows={ROWS} emptyText="" />
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <BumperPlate number="341" side="blue" />
        <p className="text-[15px] text-fg">
          <span className="font-semibold">341:</span> +10 rank · +8 captain · +15 winner
        </p>
      </div>
    </Card>
  );
}
```

`components/landing/Landing.tsx`:

```tsx
import Link from 'next/link';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { SampleScoreboard } from '@/components/landing/SampleScoreboard';
import { SignInButtons } from '@/components/SignInButtons';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { formatDateRange } from '@/lib/format';
import type { TbaEvent } from '@/lib/tba/types';

const STEPS = [
  { title: 'Draft', text: 'Snake draft FRC teams live from your phone.' },
  { title: 'Watch', text: 'Points come from real results on The Blue Alliance.' },
  { title: 'Win', text: 'Rounds add up to season standings.' },
];

export function Landing({ upcoming, authError, next }: { upcoming: TbaEvent[]; authError: boolean; next: string }) {
  return (
    <main id="main" className="space-y-8">
      <section className="space-y-5 pt-2">
        <h1 className="font-display text-[40px] font-bold uppercase leading-[42px] text-fg">
          Draft FRC teams. Watch every match. Roast your friends.
        </h1>
        <p className="text-[17px] leading-6 text-fg">
          Fantasy leagues for FIRST Robotics: draft teams before an event, then their real results turn into points.
        </p>
        {authError ? <Alert tone="danger">Sign-in didn&apos;t finish — try again.</Alert> : null}
        <SignInButtons next={next} />
        <InviteCodeBox />
      </section>

      <SampleScoreboard />

      <section className="space-y-3">
        <h2 className="font-display text-[22px] font-bold text-fg">How it works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title} eyebrow={`Step ${i + 1}`} title={s.title}>
              <p className="text-[15px] text-fg-muted">{s.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[22px] font-bold text-fg">Two ways to play</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Event-by-event">
            <p className="text-[15px] text-fg-muted">A fresh draft before each event you follow. Rounds roll up into a season.</p>
          </Card>
          <Card title="Full season">
            <p className="text-[15px] text-fg-muted">Draft once; your teams score at every official event all season.</p>
          </Card>
        </div>
      </section>

      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-[22px] font-bold text-fg">Coming up</h2>
          <Card>
            <ul className="-mx-2 divide-y divide-border">
              {upcoming.map((e) => (
                <li key={e.key} className="flex min-h-14 items-center justify-between gap-3 px-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-fg">{e.name}</span>
                    <span className="block text-sm text-fg-muted">{formatDateRange(e.start_date, e.end_date)}</span>
                  </span>
                  <Link
                    href={`/leagues/new?event=${e.key}`}
                    className="flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Start a league for this event
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
```

`app/page.tsx` (whole file; Task 17 replaces the signed-in branch with the Me tab):

```tsx
import { redirect } from 'next/navigation';
import { Landing } from '@/components/landing/Landing';
import { safeNext } from '@/lib/auth/next';
import { getUser } from '@/lib/auth/session';
import { loadUpcomingEvents } from '@/lib/views/landing';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { searchParams: Promise<{ auth_error?: string; next?: string }> };

export default async function HomePage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await getUser();
  if (user) redirect(safeNext(sp.next) === '/' ? '/leagues' : safeNext(sp.next));
  return <Landing upcoming={await loadUpcomingEvents(new Date())} authError={sp.auth_error === '1'} next={safeNext(sp.next)} />;
}
```

- [ ] **Step 4: Run tests, typecheck, check 360 px both themes**

Run: `npx vitest run tests/views/landing.test.ts tests/ui/landing.test.ts && npm run typecheck && npm test`
Expected: PASS. Open `/` signed out: hero fits at 360 px (the headline wraps, no horizontal scroll), Coming up shows real events.

- [ ] **Step 5: Commit**

```bash
git add lib/views/landing.ts components/landing app/page.tsx tests/views/landing.test.ts tests/ui/landing.test.ts
git commit -m "feat(ui): landing page with sign-in, sample scoreboard, and upcoming events"
```

---
### Task 17: Me tab (signed-in `/`) and richer Leagues rows

**Files:**
- Create: `lib/views/me.ts`, `components/me/MeHome.tsx`, `components/me/LeagueRows.tsx`
- Modify: `app/page.tsx` (signed-in branch), `app/leagues/page.tsx` (use `LeagueRows`)
- Test: `tests/views/me.test.ts`, `tests/ui/me.test.ts`

**Interfaces:**
- Consumes: `loadLeaguePage` (`lib/views/league.ts`), `getTba`, `cacheWindowFor`/`localDate`/`addDays` (`lib/rounds/status.ts`), `hasResult` (`lib/scoring/matches.ts`), repo `listLeaguesForUser`.
- Produces: `matchLabel(m: MatchSimple): string`, `nextMatchLabel(teamKey: string, matches: MatchSimple[] | null): string`, `SeasonInput`, `seasonSummary(rounds: SeasonInput[], year: string): MeSeason`, `MeLeague = { slug: string; name: string; isCommissioner: boolean; rank: number | null; total: number; anyLive: boolean; error: boolean }`, `MeTeam = { teamKey: string; leagueName: string; eventName: string; label: string; status: 'live' | 'upcoming' }`, `MeSeason = { total: number; bestPick: { teamKey: string; eventName: string; points: number } | null; averageFinish: number | null }`, `MePage = { leagues: MeLeague[]; teams: MeTeam[]; season: MeSeason }`, `loadMePage(userId: string, now: Date): Promise<MePage>`. SP2 extends `loadMePage` for season rounds (plan deviation 5).

- [ ] **Step 1: Write the failing tests**

`tests/views/me.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown, getTba: vi.fn() }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...a: unknown[]) => h.getTba(...a) }));

import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { loadMePage, matchLabel, nextMatchLabel, seasonSummary } from '@/lib/views/me';
import { match } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('matchLabel', () => {
  it('names quals, double-elim matches and finals like TBA', () => {
    expect(matchLabel(match({ num: 14, red: [], blue: [] }))).toBe('Q14');
    expect(matchLabel(match({ level: 'sf', set: 5, num: 1, red: [], blue: [] }))).toBe('M5');
    expect(matchLabel(match({ level: 'f', set: 1, num: 2, red: [], blue: [] }))).toBe('F2');
    expect(matchLabel(match({ level: 'qf', set: 3, num: 2, red: [], blue: [] }))).toBe('QF3-2');
  });
});

describe('nextMatchLabel (spec §4.6 Live now)', () => {
  const played = (num: number, red: string[], blue: string[]) => match({ num, red, blue, redScore: 10, blueScore: 5 });
  const upcoming = (num: number, red: string[], blue: string[]) => match({ num, red, blue });
  it('up next / in N matches', () => {
    const ms = [played(1, ['frc1'], ['frc2']), upcoming(2, ['frc3'], ['frc4']), upcoming(3, ['frc5'], ['frc341'])];
    expect(nextMatchLabel('frc3', ms)).toBe('Q2 · up next');
    expect(nextMatchLabel('frc341', ms)).toBe('Q3 · in 1 match');
    ms.push(upcoming(4, ['frc6'], ['frc7']), upcoming(5, ['frc8'], ['frc2']));
    expect(nextMatchLabel('frc2', ms)).toBe('Q5 · in 3 matches');
  });
  it('quals done, eliminated, done, no schedule', () => {
    expect(nextMatchLabel('frc1', [played(1, ['frc1'], ['frc2']), upcoming(2, ['frc3'], ['frc4'])])).toBe('Quals done');
    const elim = [played(1, ['frc1'], ['frc2']), match({ level: 'sf', set: 1, num: 1, red: ['frc3'], blue: ['frc4'] })];
    expect(nextMatchLabel('frc1', elim)).toBe('Eliminated');
    expect(nextMatchLabel('frc1', [played(1, ['frc1'], ['frc2'])])).toBe('Done');
    expect(nextMatchLabel('frc1', [])).toBe('Schedule not posted');
    expect(nextMatchLabel('frc1', null)).toBe('Schedule not posted');
  });
});

describe('seasonSummary (spec §4.6 My season)', () => {
  it('totals this year, finds the best pick, averages finished rounds only', () => {
    const out = seasonSummary(
      [
        { eventName: 'Ramp Riot', startDate: '2026-10-24', finalized: true, me: { total: 120, rank: 2, teams: [{ teamKey: 'frc341', total: 62 }, { teamKey: 'frc5181', total: 58 }] } },
        { eventName: 'Brunswick Eruption', startDate: '2026-11-07', finalized: true, me: { total: 80, rank: 1, teams: [{ teamKey: 'frc1', total: 40 }] } },
        { eventName: 'Next Up', startDate: '2026-12-05', finalized: false, me: { total: 10, rank: 4, teams: [] } },
        { eventName: 'Last Year', startDate: '2025-10-25', finalized: true, me: { total: 999, rank: 1, teams: [{ teamKey: 'frc9', total: 500 }] } },
        { eventName: 'Not in it', startDate: '2026-10-01', finalized: true, me: null },
      ],
      '2026',
    );
    expect(out).toEqual({ total: 210, bestPick: { teamKey: 'frc341', eventName: 'Ramp Riot', points: 62 }, averageFinish: 1.5 });
  });
  it('is empty-safe', () => {
    expect(seasonSummary([], '2026')).toEqual({ total: 0, bestPick: null, averageFinish: null });
  });
});

describe('loadMePage', () => {
  let repo: Repo;
  beforeEach(() => {
    repo = createMemoryRepo();
    h.repo = repo;
    h.getTba.mockResolvedValue({ data: null, fetchedAt: null, stale: false });
  });

  it('lists my leagues with rank and total, and marks one that fails to load', async () => {
    await repo.createProfile({ id: 'u1', displayName: 'Joey', avatarUrl: null });
    const good = await repo.createLeague({ slug: 'good-abc234', name: 'Good', defaultScoring: defaultScoring() });
    const bad = await repo.createLeague({ slug: 'bad-abc234', name: 'Bad', defaultScoring: defaultScoring() });
    await repo.createMember({ leagueId: good.id, userId: 'u1', name: 'Joey', role: 'commissioner' });
    await repo.createMember({ leagueId: bad.id, userId: 'u1', name: 'Joey', role: 'player' });
    const real = repo.listRounds.bind(repo);
    vi.spyOn(repo, 'listRounds').mockImplementation(async (id) => {
      if (id === bad.id) throw new Error('boom');
      return real(id);
    });

    const page = await loadMePage('u1', new Date('2026-10-01T12:00:00Z'));
    expect(page.leagues).toEqual([
      { slug: 'good-abc234', name: 'Good', isCommissioner: true, rank: 1, total: 0, anyLive: false, error: false },
      { slug: 'bad-abc234', name: 'Bad', isCommissioner: false, rank: null, total: 0, anyLive: false, error: true },
    ]);
    expect(page.teams).toEqual([]);
  });
});
```

`tests/ui/me.test.ts`:

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import { MeHome } from '@/components/me/MeHome';

const season = { total: 210, bestPick: { teamKey: 'frc341', eventName: 'Ramp Riot', points: 62 }, averageFinish: 1.5 };

describe('MeHome (spec §4.6)', () => {
  it('shows live teams, league rows, and season stats', () => {
    const out = render(
      h(MeHome, {
        page: {
          leagues: [
            { slug: 'fam', name: 'Habich Fam', isCommissioner: true, rank: 2, total: 184, anyLive: true, error: false },
            { slug: 'bad', name: 'Broken', isCommissioner: false, rank: null, total: 0, anyLive: false, error: true },
          ],
          teams: [{ teamKey: 'frc341', leagueName: 'Habich Fam', eventName: 'Ramp Riot', label: 'Q14 · up next', status: 'live' }],
          season,
        },
      }),
    );
    for (const text of ['Live now', '341', 'Q14 · up next', 'Habich Fam', '#2', '184', 'Couldn&#x27;t load', 'My season', '210', '341 at Ramp Riot · +62', '1.5']) {
      expect(out, text).toContain(text);
    }
  });
  it('empty state: create or join', () => {
    const out = render(h(MeHome, { page: { leagues: [], teams: [], season: { total: 0, bestPick: null, averageFinish: null } } }));
    expect(out).toContain('Create a league');
    expect(out).toContain('Have an invite code?');
    expect(out).not.toContain('Live now');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/views/me.test.ts tests/ui/me.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `lib/views/me.ts`**

```ts
import { getRepo } from '@/lib/db';
import { addDays, cacheWindowFor, localDate } from '@/lib/rounds/status';
import { hasResult } from '@/lib/scoring/matches';
import { getTba } from '@/lib/tba/client';
import type { MatchSimple } from '@/lib/tba/types';
import { loadLeaguePage } from '@/lib/views/league';

export type MeLeague = {
  slug: string;
  name: string;
  isCommissioner: boolean;
  rank: number | null;
  total: number;
  anyLive: boolean;
  /** This league failed to load; its row says "Couldn't load" (spec §4.8). */
  error: boolean;
};
export type MeTeam = { teamKey: string; leagueName: string; eventName: string; label: string; status: 'live' | 'upcoming' };
export type MeSeason = {
  total: number;
  bestPick: { teamKey: string; eventName: string; points: number } | null;
  averageFinish: number | null;
};
export type MePage = { leagues: MeLeague[]; teams: MeTeam[]; season: MeSeason };

const LEVELS: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
const order = (a: MatchSimple, b: MatchSimple) =>
  (LEVELS[a.comp_level] ?? 9) - (LEVELS[b.comp_level] ?? 9) || a.set_number - b.set_number || a.match_number - b.match_number;

export function matchLabel(m: MatchSimple): string {
  if (m.comp_level === 'qm') return `Q${m.match_number}`;
  if (m.comp_level === 'f') return `F${m.match_number}`;
  if (m.comp_level === 'sf' && m.match_number === 1) return `M${m.set_number}`; // double elimination (2023+)
  return `${m.comp_level.toUpperCase()}${m.set_number}-${m.match_number}`;
}

const plays = (m: MatchSimple, teamKey: string) =>
  Boolean(m.alliances?.red?.team_keys?.includes(teamKey) || m.alliances?.blue?.team_keys?.includes(teamKey));

/** "Q14 · up next" / "Q14 · in 2 matches" / "Quals done" / "Eliminated" / "Done" (spec §4.6). */
export function nextMatchLabel(teamKey: string, matches: MatchSimple[] | null): string {
  if (!matches || matches.length === 0) return 'Schedule not posted';
  const unplayed = matches.filter((m) => !hasResult(m)).sort(order);
  const i = unplayed.findIndex((m) => plays(m, teamKey));
  if (i === 0) return `${matchLabel(unplayed[0])} · up next`;
  if (i > 0) return `${matchLabel(unplayed[i])} · in ${i} ${i === 1 ? 'match' : 'matches'}`;
  if (unplayed.length === 0) return 'Done';
  return unplayed.some((m) => m.comp_level === 'qm') ? 'Quals done' : 'Eliminated';
}

export type SeasonInput = {
  eventName: string;
  startDate: string;
  finalized: boolean;
  me: { total: number; rank: number; teams: { teamKey: string; total: number }[] } | null;
};

/** "My season" (spec §4.6): calendar-year total, best single team-in-a-round, mean rank over finalized rounds. */
export function seasonSummary(rounds: SeasonInput[], year: string): MeSeason {
  const mine = rounds.filter((r) => r.me !== null && r.startDate.startsWith(year));
  let total = 0;
  let bestPick: MeSeason['bestPick'] = null;
  for (const r of mine) {
    total += r.me!.total;
    for (const t of r.me!.teams) {
      if (!bestPick || t.total > bestPick.points) bestPick = { teamKey: t.teamKey, eventName: r.eventName, points: t.total };
    }
  }
  const finals = mine.filter((r) => r.finalized);
  const averageFinish =
    finals.length === 0 ? null : Math.round((finals.reduce((s, r) => s + r.me!.rank, 0) / finals.length) * 10) / 10;
  return { total, bestPick, averageFinish };
}

/** Everything the Me tab shows. Leagues load in parallel; one failing league doesn't break the page. */
export async function loadMePage(userId: string, now: Date): Promise<MePage> {
  const memberships = await getRepo().listLeaguesForUser(userId);
  const results = await Promise.allSettled(memberships.map((m) => loadLeaguePage(m.league.slug, now)));

  const leagues: MeLeague[] = [];
  const teams: MeTeam[] = [];
  const seasonRounds: SeasonInput[] = [];
  const today = localDate(now, 'America/New_York');

  for (let i = 0; i < memberships.length; i++) {
    const { league, player } = memberships[i];
    const result = results[i];
    const base = { slug: league.slug, name: league.name, isCommissioner: player.role === 'commissioner' };
    if (result.status === 'rejected' || result.value === null) {
      if (result.status === 'rejected') console.error(result.reason);
      leagues.push({ ...base, rank: null, total: 0, anyLive: false, error: true });
      continue;
    }
    const page = result.value;
    const row = page.standings.find((s) => s.playerId === player.id);
    leagues.push({ ...base, rank: row?.rank ?? null, total: row?.total ?? 0, anyLive: page.anyLive, error: false });

    for (const view of page.rounds) {
      const me = view.scores.find((s) => s.playerId === player.id) ?? null;
      seasonRounds.push({
        eventName: view.round.eventName,
        startDate: view.round.startDate,
        finalized: view.round.finalizedAt !== null,
        me: me && { total: me.total, rank: me.rank, teams: me.teams.map((t) => ({ teamKey: t.teamKey, total: t.total })) },
      });

      const soon = view.status === 'upcoming' && view.round.startDate <= addDays(today, 7);
      if (view.status !== 'live' && !soon) continue;
      const myTeams = view.picks.filter((p) => p.playerId === player.id).map((p) => p.teamKey);
      if (myTeams.length === 0) continue;
      const matches = await getTba<MatchSimple[]>(`/event/${view.round.eventKey}/matches/simple`, {
        windowMs: cacheWindowFor(view.round, now),
      });
      for (const teamKey of myTeams) {
        teams.push({
          teamKey,
          leagueName: league.name,
          eventName: view.round.eventName,
          label: nextMatchLabel(teamKey, Array.isArray(matches.data) ? matches.data : null),
          status: view.status === 'live' ? 'live' : 'upcoming',
        });
      }
    }
  }
  return { leagues, teams, season: seasonSummary(seasonRounds, today.slice(0, 4)) };
}
```

(`loadLeaguePage`'s standings include every league player; a league with only me ranks me #1 with 0 — which is what the test expects.)

- [ ] **Step 4: Implement the components and wire the pages**

`components/me/LeagueRows.tsx`:

```tsx
import Link from 'next/link';
import type { MeLeague } from '@/lib/views/me';

/** "My leagues" rows (spec §4.6): shared by the Me tab and the Leagues tab. */
export function LeagueRows({ leagues }: { leagues: MeLeague[] }) {
  return (
    <ul className="-mx-2 divide-y divide-border">
      {leagues.map((l) => (
        <li key={l.slug}>
          <Link
            href={`/l/${l.slug}`}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-fg/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {l.anyLive ? (
              <span aria-label="Live" className="size-2.5 shrink-0 rounded-full bg-success ring-4 ring-success/25 motion-safe:animate-pulse" />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg">{l.name}</span>
              {l.isCommissioner ? <span className="block text-sm font-semibold text-secondary">Commissioner</span> : null}
            </span>
            {l.error ? (
              <span className="shrink-0 text-sm text-fg-muted">Couldn&apos;t load</span>
            ) : (
              <span className="shrink-0 text-right tabular-nums">
                <span className="block font-display text-xl font-bold text-fg">{l.total}</span>
                <span className="block text-sm text-fg-muted">{l.rank ? `#${l.rank}` : '—'}</span>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

`components/me/MeHome.tsx`:

```tsx
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { LeagueRows } from '@/components/me/LeagueRows';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { teamLabel } from '@/lib/teams';
import type { MePage } from '@/lib/views/me';

export function MeHome({ page }: { page: MePage }) {
  const { leagues, teams, season } = page;
  if (leagues.length === 0) {
    return (
      <main id="main" className="space-y-6">
        <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Welcome!</h1>
        <Card className="space-y-4">
          <p className="text-[15px] text-fg-muted">You&apos;re not in a league yet.</p>
          <Button href="/leagues/new">Create a league</Button>
          <InviteCodeBox />
        </Card>
      </main>
    );
  }
  const live = teams.some((t) => t.status === 'live');
  return (
    <main id="main" className="space-y-6">
      <h1 className="sr-only">Me</h1>
      {teams.length > 0 ? (
        <Card title={live ? 'Live now' : 'Up next'} className="space-y-2">
          <ul className="divide-y divide-border">
            {teams.map((t, i) => (
              <li key={`${t.leagueName}:${t.teamKey}`} className="flex min-h-14 items-center gap-3 py-2">
                <BumperPlate number={teamLabel(t.teamKey)} side={i % 2 === 0 ? 'blue' : 'red'} />
                <span className="min-w-0">
                  <span className="block font-semibold text-fg">{t.label}</span>
                  <span className="block truncate text-sm text-fg-muted">
                    {t.leagueName} · {t.eventName}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="My leagues">
        <LeagueRows leagues={leagues} />
      </Card>
      <Card title="My season" className="space-y-2">
        <p className="font-display text-[32px] font-bold tabular-nums text-fg">{season.total}</p>
        <p className="text-[15px] text-fg-muted">
          Best pick:{' '}
          {season.bestPick
            ? `${teamLabel(season.bestPick.teamKey)} at ${season.bestPick.eventName} · +${season.bestPick.points}`
            : '—'}
        </p>
        <p className="text-[15px] text-fg-muted">Average finish: {season.averageFinish ?? '—'}</p>
      </Card>
    </main>
  );
}
```

`app/page.tsx` — replace the signed-in `redirect` line with:

```tsx
  if (user) {
    const next = safeNext(sp.next);
    if (next !== '/') redirect(next);
    return <MeHome page={await loadMePage(user.id, new Date())} />;
  }
```

(imports: `MeHome` from `@/components/me/MeHome`, `loadMePage` from `@/lib/views/me`.)

`app/leagues/page.tsx` — replace the `listLeaguesForUser` list with `const { leagues } = await loadMePage(user.id, new Date());` and render `<LeagueRows leagues={leagues} />` inside the first card (keep the empty message, the Create league button and the `InviteCodeBox` card); add `export const maxDuration = 30;`.

- [ ] **Step 5: Run tests, typecheck, look at it**

Run: `npx vitest run tests/views/me.test.ts tests/ui/me.test.ts && npm run typecheck && npm test`
Expected: PASS. Signed in (test login), with a league you created: `/` shows My leagues and My season; 360 px both themes.

- [ ] **Step 6: Commit**

```bash
git add lib/views/me.ts components/me app/page.tsx app/leagues/page.tsx tests/views/me.test.ts tests/ui/me.test.ts
git commit -m "feat(ui): Me tab with live teams, league ranks, and season stats"
```

---

### Task 18: Admin Members section and Delete league

**Files:**
- Create: `components/admin/MembersCard.tsx`, `components/admin/DangerZone.tsx`
- Modify: `components/admin/AdminDashboard.tsx` (replace the Players card; add Members + Danger zone), `components/admin/DashboardParts.tsx` (delete `PlayerRow` and `AddForm` — no other users), `lib/api/types.ts` (`AdminState.me`), `app/api/l/[slug]/admin/state/route.ts`
- Test: `tests/ui/admin-components.test.ts`, `tests/api/league.test.ts` (state `me`)

**Interfaces:**
- Consumes: `AdminPlayer` (Task 7), `AdminLeague` with `inviteCode`/`visibility` (Task 8), admin routes `/players/{id}` PATCH/DELETE, `/invite` POST, `/league` PATCH/DELETE.
- Produces: `AdminState.me: string` (the viewer's player id); `removeConfirmText(p: AdminPlayer): string`; `MembersCard({ inviteLink, league, players, me, busy, pending, onReset, onVisibility, onRole, onRemove })`; `DangerZone({ leagueName, busy, onDelete })`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/admin-components.test.ts`:

```ts
import { DangerZone } from '@/components/admin/DangerZone';
import { MembersCard, removeConfirmText } from '@/components/admin/MembersCard';

const members = [
  { id: 'p1', name: 'Joey', inUse: true, role: 'commissioner' as const, linked: true },
  { id: 'p2', name: 'Mom', inUse: true, role: 'player' as const, linked: true },
  { id: 'p3', name: 'Grandpa', inUse: true, role: 'player' as const, linked: false },
];
const league = { slug: 'fam', name: 'Habich Fam', homeTeamNumber: 5181, defaultScoring: DEFAULT_SCORING, inviteCode: 'ABC234', visibility: 'link' as const };
const noop = () => {};

describe('MembersCard (spec §4.6 admin additions)', () => {
  const html = render(
    h(MembersCard, {
      inviteLink: 'https://x.test/join/ABC234', league, players: members, me: 'p1', busy: false, pending: null,
      onReset: noop, onVisibility: noop, onRole: noop, onRemove: noop,
    }),
  );
  it('shows the invite code, copy link and reset', () => {
    expect(html).toContain('ABC234');
    expect(html).toContain('Copy invite link');
    expect(html).toContain('Reset code');
  });
  it('shows roles, "(you)", and former members as "(left)" without a role toggle', () => {
    expect(html).toContain('Joey (you)');
    expect(html).toContain('Grandpa (left)');
    expect(html).toContain('Make commissioner'); // for Mom
    expect(html).toContain('Make player'); // for Joey
    expect(html.match(/Make commissioner/g)).toHaveLength(1); // not for Grandpa
  });
  it('shows the visibility choice', () => {
    expect(html).toContain('Anyone with the link');
    expect(html).toContain('Members only');
  });
});

describe('removeConfirmText', () => {
  it('explains that someone with history stays in past standings', () => {
    expect(removeConfirmText(members[1])).toBe(
      'Remove Mom? They have picks or are in a draft order, so they stay in past standings as "Mom (left)".',
    );
    expect(removeConfirmText({ ...members[1], inUse: false })).toBe('Remove Mom from the league?');
  });
});

describe('DangerZone', () => {
  it('asks for the league name and starts disabled', () => {
    const out = render(h(DangerZone, { leagueName: 'Habich Fam', busy: false, onDelete: noop }));
    expect(out).toContain('Type Habich Fam to confirm');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Delete league/);
  });
});
```

In `tests/api/league.test.ts`, in the state test, add `expect(body.me).toBe(commissioner.id);`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/ui/admin-components.test.ts tests/api/league.test.ts`
Expected: FAIL — components missing, `me` undefined.

- [ ] **Step 3: Implement**

`lib/api/types.ts` — add to `AdminState`: `/** The viewer's own player id, for "(you)". */ me: string;`. In `app/api/l/[slug]/admin/state/route.ts` destructure `player` from `requireLeagueRole` and add `me: player.id` to the state object.

`components/admin/MembersCard.tsx`:

```tsx
'use client';

import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AdminLeague, AdminPlayer } from '@/lib/api/types';

export function removeConfirmText(p: AdminPlayer): string {
  return p.inUse
    ? `Remove ${p.name}? They have picks or are in a draft order, so they stay in past standings as "${p.name} (left)".`
    : `Remove ${p.name} from the league?`;
}

type Props = {
  inviteLink: string;
  league: AdminLeague;
  players: AdminPlayer[];
  me: string;
  busy: boolean;
  /** The running action's key, e.g. "role:{id}", "remove:{id}", "reset", "visibility". */
  pending: string | null;
  onReset: () => void;
  onVisibility: (v: 'link' | 'members') => void;
  onRole: (id: string, role: 'commissioner' | 'player') => void;
  onRemove: (p: AdminPlayer) => void;
};

/** Members section of the commissioner dashboard (spec §4.6). */
export function MembersCard({ inviteLink, league, players, me, busy, pending, onReset, onVisibility, onRole, onRemove }: Props) {
  return (
    <Card title="Members" className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-sm font-semibold text-fg">Invite code</p>
        <p className="font-mono text-2xl font-bold tracking-[0.2em] text-fg">{league.inviteCode}</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={inviteLink} label="Copy invite link" />
          <Button
            type="button"
            variant="ghost"
            busy={pending === 'reset'}
            disabled={busy}
            onClick={() => {
              if (window.confirm('Make a new code? The old code and link stop working.')) onReset();
            }}
          >
            Reset code
          </Button>
        </div>
      </div>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-semibold text-fg">Who can see the league?</legend>
        {(
          [
            ['link', 'Anyone with the link'],
            ['members', 'Members only'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="visibility"
              checked={league.visibility === value}
              disabled={busy}
              onChange={() => onVisibility(value)}
              className="size-4"
            />
            <span className="text-fg">{label}</span>
          </label>
        ))}
      </fieldset>

      <ul className="-mx-2 divide-y divide-border">
        {players.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg">
                {p.name}
                {p.id === me ? ' (you)' : ''}
                {!p.linked ? ' (left)' : ''}
              </span>
              {p.role === 'commissioner' ? <span className="text-sm font-semibold text-secondary">Commissioner</span> : null}
            </span>
            {p.linked ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  busy={pending === `role:${p.id}`}
                  disabled={busy}
                  onClick={() => onRole(p.id, p.role === 'commissioner' ? 'player' : 'commissioner')}
                >
                  {p.role === 'commissioner' ? 'Make player' : 'Make commissioner'}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  busy={pending === `remove:${p.id}`}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(removeConfirmText(p))) onRemove(p);
                  }}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

`components/admin/DangerZone.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

/** Delete league (spec §4.4): typing the league name exactly enables the button. */
export function DangerZone({ leagueName, busy, onDelete }: { leagueName: string; busy: boolean; onDelete: (typed: string) => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Card title="Danger zone" className="space-y-3 border-red-alliance/50">
      <p className="text-[15px] text-fg-muted">Deleting the league removes every round, pick and adjustment. It can&apos;t be undone.</p>
      <Input label={`Type ${leagueName} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      <Button type="button" variant="danger" disabled={busy || typed.trim() !== leagueName} onClick={() => onDelete(typed)}>
        Delete league
      </Button>
    </Card>
  );
}
```

`components/admin/AdminDashboard.tsx` — replace the whole Players `<section>` with:

```tsx
      <section>
        <MembersCard
          inviteLink={typeof window === 'undefined' ? '' : `${window.location.origin}/join/${state.league.inviteCode}`}
          league={state.league}
          players={state.players}
          me={state.me}
          busy={busy}
          pending={pending}
          onReset={() => run('reset', () => api('/invite', { method: 'POST' }), 'New invite code made. The old one no longer works.')}
          onVisibility={(visibility) => run('visibility', () => api('/league', { method: 'PATCH', body: { visibility } }))}
          onRole={(id, role) => run(`role:${id}`, () => api(`/players/${id}`, { method: 'PATCH', body: { role } }))}
          onRemove={(p) => run(`remove:${p.id}`, () => api(`/players/${p.id}`, { method: 'DELETE' }), `${p.name} was removed.`)}
        />
      </section>
```

and after the Default scoring section:

```tsx
      <section>
        <DangerZone
          leagueName={state.league.name}
          busy={busy}
          onDelete={(confirmName) =>
            run('delete-league', async () => {
              await api('/league', { method: 'DELETE', body: { confirmName } });
              window.location.assign('/leagues');
            })
          }
        />
      </section>
```

Update the imports (drop `AddForm`, `PlayerRow`; add `MembersCard`, `DangerZone`). Then run `grep -rn "AddForm\|PlayerRow" components app` — if only their definitions in `components/admin/DashboardParts.tsx` remain, delete both definitions (and imports only they used). The "Copy public link" button at the top stays.

- [ ] **Step 4: Run tests, typecheck, look at it**

Run: `npx vitest run tests/ui tests/api && npm run typecheck && npm test`
Expected: PASS. In the browser as a commissioner: copy link, reset code (a new code appears), switch visibility, promote/demote a second test user, remove them; Delete league stays disabled until the exact name is typed. 360 px both themes.

- [ ] **Step 5: Commit**

```bash
git add components/admin lib/api/types.ts "app/api/l/[slug]/admin/state/route.ts" tests/ui/admin-components.test.ts tests/api/league.test.ts
git commit -m "feat(admin): Members section (invite code, visibility, roles, remove) and Delete league"
```

---

## Batch D — ship

### Task 19: Real-database check for the accounts schema

**Files:**
- Modify: `scripts/db-smoke.ts`

**Interfaces:**
- Consumes: every repo method from Task 4, against real Postgres.

- [ ] **Step 1: Add an accounts section to the smoke script**

In `scripts/db-smoke.ts`, inside `main`, after the existing `try { … } finally { … }` block and before the final `check('league delete cascades', …)`, add:

```ts
  // v2 SP1: accounts (spec §4). Needs a real auth user because profiles.id references auth.users.
  const db = createSupabaseClient();
  const email = `smoke-${Date.now().toString(36)}@example.com`;
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const userId = created.data.user.id;
  let accountsLeagueId: string | null = null;
  try {
    const profile = await repo.createProfile({ id: userId, displayName: 'Smoke', avatarUrl: null });
    check('profile round-trips', profile.displayName === 'Smoke' && profile.frcTeam === null);
    check('createProfile twice returns the first row',
      (await repo.createProfile({ id: userId, displayName: 'Other', avatarUrl: null })).displayName === 'Smoke');

    const acc = await repo.createLeague({
      slug: `smoke-acc-${Date.now().toString(36)}`, name: 'Smoke Accounts', defaultScoring: defaultScoring(), createdBy: userId,
    });
    accountsLeagueId = acc.id;
    check('invite code comes from gen_invite_code()', /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(acc.inviteCode));
    check('visibility defaults to link, admin token is null', acc.visibility === 'link' && acc.adminTokenHash === null);
    check('lookup by invite code', (await repo.getLeagueByInviteCode(acc.inviteCode))?.id === acc.id);
    check('reset changes the code', (await repo.resetInviteCode(acc.id)).inviteCode !== acc.inviteCode);
    check('countLeaguesCreatedBy', (await repo.countLeaguesCreatedBy(userId)) === 1);

    const me = await repo.createMember({ leagueId: acc.id, userId, name: 'Smoke', role: 'commissioner' });
    check('one membership per user per league',
      (await constraintOf(repo.createMember({ leagueId: acc.id, userId, name: 'Smoke 2', role: 'player' }))) === 'players_league_user');
    check('listLeaguesForUser joins the league', (await repo.listLeaguesForUser(userId))[0]?.league.id === acc.id);
    check('unlink keeps the row', (await repo.updatePlayer(me.id, { userId: null })).userId === null);

    const code = await db.rpc('gen_invite_code');
    check('gen_invite_code is callable by the service role', typeof code.data === 'string');
  } finally {
    await repo.deleteUser(userId);
    if (accountsLeagueId) await repo.deleteLeague(accountsLeagueId);
  }
  check('deleteUser removes the profile', (await repo.getProfile(userId)) === null);

  // RLS on, no policies (spec §8.1): the public anon key sees nothing and can't call our functions.
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  for (const table of ['leagues', 'players', 'profiles', 'rounds', 'picks', 'adjustments', 'tba_cache']) {
    const leaked = await anon.from(table).select('*').limit(1);
    check(`anon key reads no ${table}`, (leaked.data ?? []).length === 0);
  }
  check('anon key cannot call gen_invite_code', (await anon.rpc('gen_invite_code')).error !== null);
```

- [ ] **Step 2: Run it against the dev project**

Run: `npx tsx --env-file=.env.local scripts/db-smoke.ts`
Expected: every line starts with `ok`; exit code 0. If a check prints `FAIL`, fix the repo method or migration (never the check) and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/db-smoke.ts
git commit -m "test(db): real-database smoke checks for the accounts schema and RLS"
```

---

### Task 20: Joey's one-time OAuth setup, env vars, and docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`

A guided part (Joey clicks through three consoles, ~30 min, spec §11) and a docs part. Walk Joey through one step at a time and wait for "done" before the next.

- [ ] **Step 1 (Joey): Google**

1. Supabase dashboard → Authentication → Providers → Google: copy the **Callback URL** shown there (`https://<project-ref>.supabase.co/auth/v1/callback`).
2. console.cloud.google.com → project picker → **New project** "FRC Fantasy".
3. APIs & Services → **OAuth consent screen** → External → app name "FRC Fantasy", support email, scopes `email`, `profile`, `openid` → Save. Publishing status: **In production** (otherwise only listed test users can sign in).
4. APIs & Services → Credentials → **Create credentials → OAuth client ID** → Web application → Authorized redirect URIs: paste the Supabase callback URL → Create. Keep the Client ID and secret open.

- [ ] **Step 2 (Joey): Discord**

discord.com/developers/applications → **New Application** "FRC Fantasy" → OAuth2 → Redirects → **Add Redirect**: the same Supabase callback URL → Save. Copy the Client ID; **Reset Secret** → copy the secret.

- [ ] **Step 3 (Joey): Supabase**

1. Authentication → Providers → **Google** → enable, paste Client ID + secret → Save. **Discord** → the same.
2. Authentication → URL Configuration → **Site URL** `https://frc-fantasy-6yo3.vercel.app`; **Redirect URLs**: add `https://frc-fantasy-6yo3.vercel.app/**` and `http://localhost:3000/**`.
3. Project Settings → API: copy the **Project URL** and the **anon / publishable** key.

- [ ] **Step 4 (Joey): env vars**

`.env.local` (never committed): set `NEXT_PUBLIC_SUPABASE_URL` (= `SUPABASE_URL`), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET` (`openssl rand -base64 32`), `E2E_AUTH_SECRET` (another `openssl rand -base64 32`); delete `CREATE_LEAGUE_PASSCODE`.
Vercel → Settings → Environment Variables (Production + Preview): add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`. **Never** add `E2E_AUTH_SECRET` to Vercel. Leave `CREATE_LEAGUE_PASSCODE` in Vercel until Task 21 (the live v1 site reads it until the merge).

- [ ] **Step 5: Verify sign-in locally**

`npm run dev` → `http://localhost:3000` → **Continue with Google** → back on `/` signed in (Me tab empty state). Sign out from `/me/settings`, then **Continue with Discord** → the same. Supabase → Authentication → Users shows both; Table Editor → `profiles` has one row per user. Then create a league at `/leagues/new`, open `/join/{code}` in a private window with the other account, join, and check the Members section. (This is also Task 11's manual check.)

- [ ] **Step 6: Update the docs**

`README.md`:
- "Running it locally": the env var list from `.env.example`; "sign in with Google or Discord (one-time setup below)".
- New section **"One-time sign-in setup"**: Steps 1–4 above, condensed.
- "Scripts": remove `rotate-admin-token`; add `delete-v1-leagues` (one-time, already run) and `seed-demo <owner-user-id> [site-url]`; keep `db-smoke`.
- Delete the **"Lost the admin link?"** section. Add **"Commissioners"**: a commissioner makes others commissioners from Admin → Members; a league always keeps at least one.
- "Deploy checklist": the three new Vercel env vars and the Supabase redirect URLs.
- "Before every event": add "check you can sign in on your phone".

`CLAUDE.md`:
- Current status: "v2 SP1 (accounts & leagues) merged <date>; next SP4 live draft" (date filled in Task 21).
- Locked decisions: replace the **v1 access** bullet with "**Access (v2):** Google/Discord sign-in via Supabase Auth; every player has an account; per-league visibility (`link` / `members`); invite codes. Admin-token links are gone."
- Source of truth: list both specs (v1 + v2) and the v2 plan index.
- Environment gotchas: "Sign-in needs `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the Supabase redirect allow-list must include the site URL" and "Local sign-in without OAuth (Playwright): `POST /api/test/login` with `Authorization: Bearer $E2E_AUTH_SECRET` — local only."

- [ ] **Step 7: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: sign-in setup, commissioners, scripts, env vars for v2 accounts"
```

---

### Task 21: Merge SP1, deploy, create the family league

**Files:** none new.

- [ ] **Step 1: Final gates on the branch**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean. Record the test count (≥ 490 plus the new tests).

Run: `grep -rn "CREATE_LEAGUE_PASSCODE\|x-commissioner-key\|generateAdminToken\|rotate-admin" app components lib scripts tests README.md .env.example`
Expected: no output.

- [ ] **Step 2: Confirm the `v1.0` tag**

Run: `git tag --list v1.0`
If empty, tag the last pre-SP1 commit on `main` (spec §10): `git tag v1.0 $(git merge-base main HEAD)`, then publish the tag to GitHub (`git` push of the tag to `origin`).

- [ ] **Step 3: Pull request**

Publish the branch and open a PR titled "v2 SP1: accounts & leagues". Body: what changed (sign-in, invite codes, roles, visibility, Me/Leagues, landing page, admin Members), this plan's deviations 1–5, migration `0002` (already applied in Task 2; additive), the env vars added, and the test count. End the body with the attribution line from the session instructions. Wait for Joey's review; merge only on his "merge it".

- [ ] **Step 4: After merge — production**

1. Vercel builds `main` automatically; wait for "Ready".
2. If production uses a different Supabase project than `.env.local` (checked in Task 2 Step 8): run `scripts/delete-v1-leagues.ts` (Joey confirms the list) and migration `0002` against production now.
3. Vercel → Environment Variables → delete `CREATE_LEAGUE_PASSCODE` → Redeploy.
4. On Joey's phone: https://frc-fantasy-6yo3.vercel.app → landing page → Continue with Google → Me tab. Both themes.

- [ ] **Step 5: Joey creates the family league**

Joey: Leagues → **Create league** → "Habich Fam" (or his choice) → Admin → Members → **Copy invite link**, kept for the Oct 22 sign-in party (spec §10). Add the Ramp Riot round now if TBA has `2026parr`, otherwise later.

- [ ] **Step 6: Record the merge**

Fill the merge date into CLAUDE.md's status line, then:

```bash
git add CLAUDE.md
git commit -m "docs: SP1 merged — accounts live"
```

Stop and report to Joey: what shipped, the test count, and "say 'go' to start SP4 (live draft)".

---

## Addendum (2026-09-30 evening) — email + password instead of Google/Discord

Joey chose email + password (confirmation off) over Google/Discord OAuth during Task 20 (spec §2 "Sign-in", §4.1, §11 updated). Run **Tasks 22 → 23 before Task 21**. Task 20's console Steps 1–5 are replaced by spec §11 (three short Supabase settings + env vars). OAuth code from Task 11 stays dormant (tested, no buttons).

### Task 22: Email + password sign-in form and `/auth/finish`

**Files:**
- Create: `lib/auth/passwordErrors.ts`, `components/SignInForm.tsx`, `app/auth/finish/route.ts`
- Modify: every renderer of `SignInButtons` → `SignInForm` (`components/JoinView.tsx`, `components/PrivateLeague.tsx`, `components/SignInCard.tsx`, `components/admin/AdminGate.tsx`, `components/landing/Landing.tsx`) and any tests asserting "Continue with Google"/"Continue with Discord"
- Delete: `components/SignInButtons.tsx`
- Test: `tests/auth/passwordErrors.test.ts`, `tests/auth/finish.test.ts`, `tests/ui/signInForm.test.ts`

**Interfaces:**
- Consumes: `createBrowserSupabase` (Task 1), `createServerSupabase` (Task 1), `safeNext` (Task 1), `ensureProfile` (Task 11), `cleanName`/`NAME_MAX` (Task 3), `json` (`lib/api/http.ts`).
- Produces: `MIN_PASSWORD = 8`; `authErrorMessage(err: { code?: string; status?: number } | null | undefined): string`; `POST /auth/finish` body `{ next?: string }` → 200 `{ redirectTo }` | 401 | 500 `{ error }`; `<SignInForm next?: string initialMode?: 'signin' | 'signup' />`.

- [ ] **Step 1: Write the failing tests**

`tests/auth/passwordErrors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { authErrorMessage, MIN_PASSWORD } from '@/lib/auth/passwordErrors';

describe('authErrorMessage (spec §4.1 error copy)', () => {
  it('maps Supabase auth error codes to friendly copy', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Wrong email or password.');
    expect(authErrorMessage({ code: 'user_already_exists' })).toBe(
      "There's already an account with that email — sign in instead.",
    );
    expect(authErrorMessage({ code: 'email_exists' })).toBe(
      "There's already an account with that email — sign in instead.",
    );
    expect(authErrorMessage({ code: 'weak_password' })).toBe('Use at least 8 characters.');
    expect(authErrorMessage({ code: 'over_request_rate_limit' })).toBe(
      'Too many tries — wait a minute and try again.',
    );
    expect(authErrorMessage({ status: 429 })).toBe('Too many tries — wait a minute and try again.');
  });
  it('falls back for anything else', () => {
    expect(authErrorMessage({ code: 'something_new' })).toBe("Couldn't sign in. Try again.");
    expect(authErrorMessage(null)).toBe("Couldn't sign in. Try again.");
  });
  it('minimum password length is 8', () => {
    expect(MIN_PASSWORD).toBe(8);
  });
});
```

`tests/auth/finish.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: null as null | { id: string; user_metadata: unknown },
  getUserError: null as null | { message: string },
  ensure: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user }, error: h.getUserError }),
      signOut: h.signOut,
    },
  }),
}));
vi.mock('@/lib/auth/profile', () => ({ ensureProfile: (...a: unknown[]) => h.ensure(...a) }));
vi.mock('@/lib/db', () => ({ getRepo: () => ({}) }));

import { POST } from '@/app/auth/finish/route';

const post = (body: unknown) =>
  POST(new Request('http://test.local/auth/finish', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));

beforeEach(() => {
  h.user = { id: 'u1', user_metadata: { full_name: 'Mom' } };
  h.getUserError = null;
  h.ensure.mockReset().mockResolvedValue({ id: 'u1' });
  h.signOut.mockClear();
});

describe('POST /auth/finish', () => {
  it('creates the profile and returns a safe redirect', async () => {
    const res = await post({ next: '/join/ABC234' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/join/ABC234' });
    expect(h.ensure).toHaveBeenCalledWith({}, h.user);
  });
  it('never redirects off-site', async () => {
    const res = await post({ next: '//evil.com' });
    expect(await res.json()).toEqual({ redirectTo: '/' });
  });
  it('401 when there is no session', async () => {
    h.user = null;
    const res = await post({});
    expect(res.status).toBe(401);
    expect(h.ensure).not.toHaveBeenCalled();
  });
  it('signs out and answers 500 when the profile cannot be created', async () => {
    h.ensure.mockRejectedValue(new Error('db down'));
    const res = await post({ next: '/' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Sign-in didn't finish — try again." });
    expect(h.signOut).toHaveBeenCalled();
  });
  it('tolerates a missing or non-JSON body', async () => {
    const res = await POST(new Request('http://test.local/auth/finish', { method: 'POST', body: 'x' }));
    expect(await res.json()).toEqual({ redirectTo: '/' });
  });
});
```

`tests/ui/signInForm.test.ts` (same SSR-render style as `tests/ui/pages.test.ts`; use `renderToStaticMarkup`):

```ts
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignInForm } from '@/components/SignInForm';

describe('SignInForm', () => {
  it('sign-in mode: email, password, switch to create account, forgot-password hint', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { next: '/leagues' }));
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('Create account');
    expect(html).toContain('Forgot your password? Ask the site admin to reset it.');
    expect(html).not.toContain('Continue with Google');
  });
  it('create-account mode asks for a name too', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { initialMode: 'signup' }));
    expect(html).toContain('Your name');
    expect(html).toContain('autocomplete="new-password"');
    expect(html).toContain('minlength="8"');
  });
});
```

(React renders `autoComplete`/`minLength` as lowercase `autocomplete`/`minlength` attributes in markup, which is what these assertions expect.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/auth/passwordErrors.test.ts tests/auth/finish.test.ts tests/ui/signInForm.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`lib/auth/passwordErrors.ts`:

```ts
/** Spec §4.1: password rules and the error copy the sign-in form shows. */
export const MIN_PASSWORD = 8;

const TAKEN = "There's already an account with that email — sign in instead.";
const SLOW_DOWN = 'Too many tries — wait a minute and try again.';

export function authErrorMessage(err: { code?: string; status?: number } | null | undefined): string {
  switch (err?.code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'user_already_exists':
    case 'email_exists':
      return TAKEN;
    case 'weak_password':
      return `Use at least ${MIN_PASSWORD} characters.`;
    case 'over_request_rate_limit':
      return SLOW_DOWN;
  }
  if (err?.status === 429) return SLOW_DOWN;
  return "Couldn't sign in. Try again.";
}
```

`app/auth/finish/route.ts`:

```ts
import { json } from '@/lib/api/http';
import { safeNext } from '@/lib/auth/next';
import { ensureProfile } from '@/lib/auth/profile';
import { getRepo } from '@/lib/db';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const DIDNT_FINISH = "Sign-in didn't finish — try again.";

/**
 * Spec §4.1: after the browser signs in or signs up with Supabase Auth, it posts here.
 * The session cookie is already set; this makes sure the profile row exists.
 */
export async function POST(request: Request): Promise<Response> {
  let next: unknown = null;
  try {
    next = ((await request.json()) as { next?: unknown })?.next ?? null;
  } catch {
    // No body or not JSON: land on "/".
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ error: DIDNT_FINISH }, 401);
  try {
    await ensureProfile(getRepo(), data.user);
  } catch (err) {
    console.error(err);
    await supabase.auth.signOut(); // never leave someone signed in without a profile
    return json({ error: DIDNT_FINISH }, 500);
  }
  return json({ redirectTo: safeNext(typeof next === 'string' ? next : null) });
}
```

`components/SignInForm.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authErrorMessage, MIN_PASSWORD } from '@/lib/auth/passwordErrors';
import { cleanName, NAME_MAX } from '@/lib/leagues/names';
import { createBrowserSupabase } from '@/lib/supabase/browser';

type Mode = 'signin' | 'signup';

/** Spec §4.1: one form for "Sign in" and "Create account". `next` is where to land afterwards. */
export function SignInForm({ next = '/', initialMode = 'signin' }: { next?: string; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === 'signup';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim();
    const displayName = signup ? cleanName(name) : null;
    if (signup && !displayName) return setError(`Enter your name (1–${NAME_MAX} characters).`);
    if (signup && password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    try {
      const auth = createBrowserSupabase().auth;
      const { error: authError } = signup
        ? await auth.signUp({ email: cleanEmail, password, options: { data: { full_name: displayName } } })
        : await auth.signInWithPassword({ email: cleanEmail, password });
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      const res = await fetch('/auth/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ next }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirectTo?: string; error?: string };
      if (!res.ok || !body.redirectTo) {
        setError(body.error ?? "Sign-in didn't finish — try again.");
        return;
      }
      window.location.assign(body.redirectTo);
    } catch {
      setError("Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {signup ? (
        <Input
          label="Your name"
          name="name"
          autoComplete="name"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      ) : null}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete={signup ? 'new-password' : 'current-password'}
        minLength={signup ? MIN_PASSWORD : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" busy={busy} className="w-full">
        {signup ? 'Create account' : 'Sign in'}
      </Button>
      <button
        type="button"
        className="min-h-11 w-full text-sm text-fg-muted underline underline-offset-2"
        onClick={() => {
          setMode(signup ? 'signin' : 'signup');
          setError(null);
        }}
      >
        {signup ? 'Have an account? Sign in' : 'New here? Create account'}
      </button>
      {!signup ? (
        <p className="text-center text-sm text-fg-muted">Forgot your password? Ask the site admin to reset it.</p>
      ) : null}
    </form>
  );
}
```

Check `components/ui/Input.tsx` and `Button.tsx` props before pasting: if `Input` has no `label` prop, wrap each field in the same `<label>` pattern `components/SettingsForm.tsx` uses; if `Button` has no `className` prop, drop `className="w-full"`. Keep the copy strings exactly.

Then replace every `SignInButtons` render with `SignInForm` (same `next` prop), delete `components/SignInButtons.tsx`, and update any test that asserted "Continue with Google"/"Continue with Discord" to assert the form instead (`type="password"` and "Sign in"). `grep -rn "SignInButtons\|Continue with" app components tests` must come back empty afterwards (except `app/auth/callback` comments).

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/auth tests/ui && npm run typecheck && npm test`
Expected: PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A lib/auth/passwordErrors.ts components/SignInForm.tsx app/auth/finish components tests
git commit -m "feat(auth): email + password sign-in form and /auth/finish (replaces OAuth buttons)"
```

---

### Task 23: Password reset script and docs for email + password

**Files:**
- Create: `scripts/reset-password.ts`
- Modify: `README.md` (sign-in setup section, scripts), `CLAUDE.md` (Access locked decision, env gotcha)

- [ ] **Step 1: Write the script**

`scripts/reset-password.ts`:

```ts
// Spec §4.1: no emails are ever sent, so the site admin resets forgotten passwords by hand.
// Usage: npx tsx --env-file=.env.local scripts/reset-password.ts <email> <new-password>
import { MIN_PASSWORD } from '@/lib/auth/passwordErrors';
import { createSupabaseClient } from '@/lib/db/supabaseRepo';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error('Usage: reset-password.ts <email> <new-password>');
  if (password.length < MIN_PASSWORD) throw new Error(`Passwords need at least ${MIN_PASSWORD} characters.`);
  const admin = createSupabaseClient().auth.admin;
  const wanted = email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const user = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (user) {
      const upd = await admin.updateUserById(user.id, { password });
      if (upd.error) throw new Error(upd.error.message);
      console.log(`Password reset for ${user.email}. Give them the new password.`);
      return;
    }
    if (data.users.length < 200) break;
  }
  throw new Error(`No account with the email ${email}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

Run `npm run typecheck` (do NOT run the script — it touches the real project).

- [ ] **Step 2: Docs**

`README.md`: replace the Google/Discord "One-time sign-in setup" section with spec §11 (three steps: Email provider with Confirm email **off** + min length 8 + anonymous sign-ins off; Site URL; env vars incl. "set them in Vercel **before** merging SP1"). Add `reset-password <email> <new-password>` to Scripts ("forgotten passwords — no emails are sent"). Remove any remaining Google/Discord setup steps; one line may say "Google/Discord sign-in code exists but is switched off."

`CLAUDE.md`: the **Access (v2)** locked decision becomes "Email + password via Supabase Auth (confirmation off, no emails sent; forgotten passwords reset with `scripts/reset-password.ts`); every player has an account; per-league visibility (`link` / `members`); invite codes. Admin-token links are gone. Google/Discord OAuth code is dormant." Env gotcha: sign-in needs the two `NEXT_PUBLIC_…` vars (locally and on Vercel).

- [ ] **Step 3: Commit**

```bash
git add scripts/reset-password.ts README.md CLAUDE.md
git commit -m "feat(scripts): reset-password for email sign-in; docs for email + password"
```
