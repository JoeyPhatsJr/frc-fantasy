export type GlossaryKey =
  | 'opr' | 'proj' | 'rp' | 'quals' | 'playoffs' | 'alliance'
  | 'queue' | 'autodraft' | 'snake' | 'pool' | 'adjust' | 'eventcode' | 'commish';

/** One wording for every stat and FRC term, shared by labels and ⓘ explainers (spec §4.7). */
export const GLOSSARY: Record<GlossaryKey, { label: string; short: string }> = {
  opr: { label: 'Robot rating (OPR)', short: "How many points a robot adds to its alliance's score, from The Blue Alliance." },
  proj: { label: 'Projected', short: "Points per event we expect, from this team's results this season and last." },
  rp: { label: 'Ranking points', short: 'Points teams earn in qualification matches; they decide the rankings.' },
  quals: { label: 'Qualification matches', short: 'The first part of an event. Every team plays several random matches.' },
  playoffs: { label: 'Playoffs', short: 'The elimination bracket after alliance selection.' },
  alliance: { label: 'Alliance selection', short: 'Top-ranked teams pick partners for the playoffs.' },
  queue: { label: 'Your queue', short: "Teams you want, in order. On auto-draft or when your timer runs out, we pick the top one still available." },
  autodraft: { label: 'Auto-draft', short: 'We pick for you each turn: the top of your queue, or else the team with the best projection.' },
  snake: { label: 'Snake order', short: 'Pick order reverses every round: first to last, then last to first.' },
  pool: { label: 'Team pool', short: 'The teams that can be drafted for this event.' },
  adjust: { label: 'Adjustments', short: 'Points the commissioner added or removed by hand, with a reason.' },
  eventcode: { label: 'Event code', short: "The Blue Alliance's ID for an event, like 2025parr." },
  commish: { label: 'Commissioner', short: 'The person who runs the league.' },
};
