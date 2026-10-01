// Real-database checks for v2 (spec §8.1, §9). Creates a throwaway league and deletes it afterwards.
// Usage: npx tsx --env-file=.env.local scripts/smoke-v2.ts
// Needs migration 0003 applied first; it stops before creating anything if 0003 looks missing.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';
import { pickerFor } from '@/lib/scoring/round';

function check(label: string, ok: boolean) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

type DbResult = { error: { code?: string; message: string } | null };

/** Direct writes go through supabase-js, which reports errors instead of throwing: make them throw. */
async function must<T extends DbResult>(query: PromiseLike<T>, what: string): Promise<T> {
  const res = await query;
  if (res.error) throw new Error(`${what}: ${res.error.code ?? ''} ${res.error.message}`);
  return res;
}

// PostgREST / Postgres codes for "no such function / column / table".
const MISSING_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01']);
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Touches every object 0003 adds, with no side effects (the nil round id matches no row, so the
 * functions return false). Returns null when all are there, or a message saying what to do.
 */
async function migration0003Problem(db: SupabaseClient): Promise<string | null> {
  const probes: [string, PromiseLike<DbResult>][] = [
    ['draft_make_pick()', db.rpc('draft_make_pick', {
      p_round_id: NIL_UUID, p_pick_number: 0, p_player_id: NIL_UUID, p_team_key: 'frc1',
      p_require_due: false, p_auto: false,
    })],
    ['draft_undo_pick()', db.rpc('draft_undo_pick', { p_round_id: NIL_UUID, p_pick_number: 0 })],
    ['draft_control()', db.rpc('draft_control', { p_round_id: NIL_UUID, p_action: 'pause' })],
    ['public_tables_without_rls()', db.rpc('public_tables_without_rls')],
    ['rounds draft columns', db.from('rounds')
      .select('draft_mode, pick_seconds, draft_started_at, draft_paused_at, paused_remaining_ms, pick_deadline')
      .limit(1)],
    ['picks.auto', db.from('picks').select('auto').limit(1)],
    ['draft_queue table', db.from('draft_queue').select('round_id').limit(1)],
    ['draft_prefs table', db.from('draft_prefs').select('round_id').limit(1)],
  ];
  const results = await Promise.all(probes.map(([, p]) => p));
  const failed = probes
    .map(([what], i) => ({ what, error: results[i].error }))
    .filter((f): f is { what: string; error: NonNullable<DbResult['error']> } => f.error !== null);
  if (failed.length === 0) return null;
  const details = failed.map((f) => `  - ${f.what}: ${f.error.code ?? 'no code'} ${f.error.message}`).join('\n');
  const missing = failed.some(
    (f) => MISSING_CODES.has(f.error.code ?? '') || /does not exist|could not find/i.test(f.error.message),
  );
  return missing
    ? `Migration 0003 looks unapplied. Run supabase/migrations/0003_live_draft.sql in the Supabase SQL editor, then re-run this script.\n${details}`
    : `Couldn't check for migration 0003 (is the Supabase project paused? wake it in the dashboard).\n${details}`;
}

async function main() {
  const db = createSupabaseClient();
  const repo = createSupabaseRepo(db);

  const problem = await migration0003Problem(db);
  if (problem) {
    console.error(`STOP  ${problem}`);
    console.error('Nothing was created.');
    process.exitCode = 1;
    return;
  }

  const noRls = await repo.rlsDisabledTables();
  check(`RLS is on for every public table${noRls.length ? ` (OFF: ${noRls.join(', ')})` : ''}`, noRls.length === 0);

  // Direct inserts keep this script independent of the app's create-league flow.
  // No auth users or profiles: the draft functions don't care whether a player has an account.
  const slug = `smoke-v2-${Date.now().toString(36)}`;
  const inserted = await db.from('leagues').insert({ slug, name: 'Smoke v2', default_scoring: defaultScoring() }).select().single();
  if (inserted.error) throw new Error(inserted.error.message);
  const leagueId = inserted.data.id as string;

  try {
    const players = await db
      .from('players')
      .insert([{ league_id: leagueId, name: 'Smoke A' }, { league_id: leagueId, name: 'Smoke B' }])
      .select();
    if (players.error) throw new Error(players.error.message);
    const [a, b] = players.data as { id: string }[];
    const order = [a.id, b.id];
    const total = 6; // rosterSize 3 × 2 players
    const round = await repo.createRound({
      leagueId, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.updateRound(round.id, { draftOrder: order, rosterSize: 3, draftMode: 'live', pickSeconds: 30 });
    const pick = (pickNumber: number, playerId: string, teamKey: string, requireDue = false) =>
      repo.makePickAtomic({ roundId: round.id, pickNumber, playerId, teamKey, requireDue, auto: requireDue });
    const setDeadlineInPast = () =>
      must(
        db.from('rounds').update({ pick_deadline: new Date(Date.now() - 5_000).toISOString() }).eq('id', round.id),
        'move the deadline into the past',
      );
    const msLeft = async () => {
      const deadline = (await repo.getRound(round.id))!.pickDeadline;
      return deadline === null ? null : Date.parse(deadline) - Date.now();
    };

    check('a live draft starts once', (await repo.draftControl(round.id, 'start')) && !(await repo.draftControl(round.id, 'start')));

    const racing = await Promise.all(['frc1', 'frc2', 'frc3', 'frc4', 'frc5'].map((t) => pick(0, a.id, t)));
    check('five phones racing for one pick: exactly one wins', racing.filter(Boolean).length === 1);
    check('…and exactly one pick is saved', (await repo.listPicks(round.id)).length === 1);

    const taken = (await repo.listPicks(round.id))[0].teamKey;
    check('a taken team is refused without an error', !(await pick(1, b.id, taken)));
    check('a timeout pick before the deadline is refused', !(await pick(1, b.id, 'frc6', true)));

    // Undo racing a timeout tick, with the deadline already passed.
    await setDeadlineInPast();
    const [undone, ticked] = await Promise.all([repo.undoPickAtomic(round.id, 0), pick(1, b.id, 'frc7', true)]);
    const count = (await repo.listPicks(round.id)).length;
    check('undo racing a tick: exactly one of them happens', undone !== ticked);
    check('…and the pick count agrees', count === (undone ? 0 : 2));
    const afterRace = (await repo.getRound(round.id))!;
    check('…and the next deadline is in the future', afterRace.pickDeadline !== null && Date.parse(afterRace.pickDeadline) > Date.now());

    // Pause after the clock ran out → resume gives ~10 s (spec §7.1).
    await setDeadlineInPast();
    check('pause works', await repo.draftControl(round.id, 'pause'));
    check('pausing after the deadline keeps 0 ms, not a negative number', (await repo.getRound(round.id))!.pausedRemainingMs === 0);
    check('picks are refused while paused', !(await pick(count, count % 2 === 0 ? a.id : b.id, 'frc8')));
    check('resume works', await repo.draftControl(round.id, 'resume'));
    const left = await msLeft();
    check(`resume gives about 10 s (${left} ms)`, left !== null && left > 8_000 && left <= 10_500);

    // Undo while paused (controller ruling, d07b604): the undone player gets a full timer on resume.
    // Pausing with the clock run out banks 0 ms, so a resume that ignored the undo would give the
    // 10 s floor instead of 30 s.
    let n = (await repo.listPicks(round.id)).length;
    if (n === 0) {
      check('a pick goes in after resume', await pick(0, pickerFor(0, order), 'frc10'));
      n = 1;
    }
    await setDeadlineInPast();
    check('pause again', await repo.draftControl(round.id, 'pause'));
    check('undo works while paused', await repo.undoPickAtomic(round.id, n - 1));
    const pausedUndo = (await repo.getRound(round.id))!;
    check(
      `…stays paused with no deadline and a full 30 s banked (${pausedUndo.pausedRemainingMs} ms)`,
      pausedUndo.draftPausedAt !== null && pausedUndo.pickDeadline === null && pausedUndo.pausedRemainingMs === 30_000,
    );
    check('resume after the paused undo works', await repo.draftControl(round.id, 'resume'));
    const fullLeft = await msLeft();
    check(`…and gives the full 30 s, not the 10 s floor (${fullLeft} ms)`, fullLeft !== null && fullLeft > 28_000 && fullLeft <= 30_500);

    // Resume on a finished draft (controller ruling, d07b604): no deadline.
    let filled = true;
    for (let i = (await repo.listPicks(round.id)).length; i < total; i++) {
      filled = (await pick(i, pickerFor(i, order), `frc${11 + i}`)) && filled;
    }
    check(`the draft fills all ${total} picks`, filled && (await repo.listPicks(round.id)).length === total);
    check('the last pick clears the deadline', (await repo.getRound(round.id))!.pickDeadline === null);
    check('pause on the finished draft works', await repo.draftControl(round.id, 'pause'));
    check('resume on the finished draft works', await repo.draftControl(round.id, 'resume'));
    const finished = (await repo.getRound(round.id))!;
    check(
      `…and sets no deadline (${finished.pickDeadline ?? 'null'})`,
      finished.pickDeadline === null && finished.draftPausedAt === null,
    );

    // Rows in every draft table, so "the anon key reads no rows" below means something.
    await repo.setQueue(round.id, a.id, ['frc20', 'frc21']);
    await repo.setAutodraft(round.id, a.id, true);

    // The anon key is public in v2: it must not reach tables or functions.
    const url = process.env.SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
      check('NEXT_PUBLIC_SUPABASE_ANON_KEY is set in .env.local (needed for the anon checks)', false);
    } else {
      const anon = createClient(url, anonKey, { auth: { persistSession: false } });
      // Arguments that would change nothing even if a call got through.
      const rpcs: [string, Record<string, unknown>][] = [
        ['draft_make_pick', {
          p_round_id: round.id, p_pick_number: 0, p_player_id: a.id, p_team_key: 'frc9',
          p_require_due: false, p_auto: false,
        }],
        ['draft_undo_pick', { p_round_id: round.id, p_pick_number: -1 }],
        ['draft_control', { p_round_id: round.id, p_action: 'nothing' }],
        ['public_tables_without_rls', {}],
      ];
      for (const [fn, args] of rpcs) {
        check(`the anon key cannot call ${fn}`, (await anon.rpc(fn, args)).error !== null);
      }
      const ourRows: [table: string, column: string][] = [
        ['rounds', 'id'], ['picks', 'round_id'], ['draft_queue', 'round_id'], ['draft_prefs', 'round_id'],
      ];
      for (const [table, column] of ourRows) {
        const rows = await anon.from(table).select(column).eq(column, round.id);
        check(`the anon key reads no ${table} rows (RLS, no policies)`, (rows.data ?? []).length === 0);
      }
    }
  } finally {
    // Always runs, even when a check threw. Deleting the league cascades to its players, rounds,
    // picks, queue and prefs; there are no auth users or profiles to remove.
    try {
      await must(db.from('leagues').delete().eq('id', leagueId), 'delete the throwaway league');
      const left = await must(db.from('leagues').select('id').eq('id', leagueId), 'look for the throwaway league');
      check('cleaned up the throwaway league', (left.data ?? []).length === 0);
    } catch (err) {
      console.error(err);
      check(`cleaned up the throwaway league (delete ${slug} by hand in the dashboard)`, false);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
