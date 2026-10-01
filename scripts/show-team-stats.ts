// Prints a team's team_stats rows and the projection a draft in <season> would show.
// Usage: npx tsx --env-file=.env.local scripts/show-team-stats.ts 5181 2026
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { projection } from '@/lib/stats/projection';

async function main() {
  const team = Number(process.argv[2]);
  const season = Number(process.argv[3]);
  if (!Number.isInteger(team) || team < 1 || !Number.isInteger(season)) {
    throw new Error('Usage: show-team-stats.ts <teamNumber> <season>   e.g. 5181 2026');
  }
  const repo = createSupabaseRepo(createSupabaseClient());
  const rows = await repo.getTeamStats([`frc${team}`], [season, season - 1], { withHistory: true });
  const cur = rows.find((r) => r.season === season) ?? null;
  const prev = rows.find((r) => r.season === season - 1) ?? null;
  for (const r of [cur, prev]) {
    if (!r) continue;
    console.log(`\n${r.teamKey} ${r.season}: ${r.eventsPlayed} events, ${r.totalPoints} pts, ` +
      `${r.qualWins}-${r.qualLosses}-${r.qualTies}, best ${r.bestFinish ?? '—'}, ` +
      `OPR ${r.latestOpr ?? '—'} / rank ${r.latestRank ?? '—'} at ${r.latestEventKey ?? '—'}`);
    for (const e of r.events) console.log(`  ${e.endDate}  ${e.eventKey.padEnd(12)} rank ${e.rank ?? '—'}  ${e.finish ?? ''}  +${e.points}`);
    for (const a of r.awards) console.log(`  award: ${a.name} (${a.eventKey})`);
  }
  const proj = projection(
    cur && { points: cur.totalPoints, events: cur.eventsPlayed },
    prev && { points: prev.totalPoints, events: prev.eventsPlayed },
  );
  console.log(`\nProj for a ${season} draft: ${proj ?? 'New'}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
