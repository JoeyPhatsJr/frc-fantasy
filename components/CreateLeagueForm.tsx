'use client';

import { useState } from 'react';
import { PoolFilterFields } from '@/components/PoolFilterFields';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { adminFetch, ApiError, createLeague } from '@/lib/admin/client';
import { parseFollowInput } from '@/lib/follow/input';
import { allowedSeasonYears, defaultSeasonYear } from '@/lib/season/calendar';
import type { PoolFilter } from '@/lib/season/poolFilter';

type Visibility = 'link' | 'members';
type Format = 'event' | 'season';

type FormatBody =
  | { format: 'event'; followTeams: number[] }
  | { format: 'season'; seasonYear: number; poolFilter: PoolFilter };

/** Where to go after creating. round_error=1 makes the dashboard say the first round wasn't added. */
export function afterCreateUrl(slug: string, roundFailed: boolean): string {
  return `/l/${slug}/admin${roundFailed ? '?round_error=1' : ''}`;
}

/**
 * Adds the prefilled event as the new league's first round. True when the event is in the league.
 * A 409 means it already is: following a team that attends the event lets the server's follow sync
 * add it first (SP2 final review, Minor 1), so that is not a failure.
 */
export async function addFirstRound(slug: string, eventKey: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    await adminFetch(slug, '/rounds', { method: 'POST', body: { eventKey } }, fetchImpl);
    return true;
  } catch (err) {
    return err instanceof ApiError && err.status === 409;
  }
}

/** The format part of the POST /api/leagues body (spec §5), or what to fix first. */
export function formatFields(input: {
  format: Format;
  follows: string;
  seasonYear: number;
  poolFilter: PoolFilter;
}): { ok: true; fields: FormatBody } | { ok: false; on: 'follows' | 'pool'; error: string } {
  if (input.format === 'season') {
    if (input.poolFilter.type === 'district' && input.poolFilter.key === '') {
      return { ok: false, on: 'pool', error: 'Pick a district' };
    }
    return { ok: true, fields: { format: 'season', seasonYear: input.seasonYear, poolFilter: input.poolFilter } };
  }
  const parsed = parseFollowInput(input.follows);
  if ('error' in parsed) return { ok: false, on: 'follows', error: parsed.error };
  return { ok: true, fields: { format: 'event', followTeams: parsed.teams } };
}

/** /leagues/new (spec §4.6, §5). With ?event=, the event becomes the first round of an event league. */
export function CreateLeagueForm({ event }: { event?: { key: string; name: string } }) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('link');
  const [format, setFormat] = useState<Format>('event');
  const [follows, setFollows] = useState('');
  const [followsError, setFollowsError] = useState<string | null>(null);
  const [seasonYear, setSeasonYear] = useState(() => defaultSeasonYear(new Date()));
  const [poolFilter, setPoolFilter] = useState<PoolFilter>({ type: 'all' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeSeasonYear(year: number) {
    setSeasonYear(year);
    // District keys carry their year, so a picked district doesn't carry over to another season.
    if (poolFilter.type === 'district') setPoolFilter({ type: 'district', key: '' });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFollowsError(null);
    const checked = formatFields({ format, follows, seasonYear, poolFilter });
    if (!checked.ok) {
      if (checked.on === 'follows') setFollowsError(checked.error);
      else setError(checked.error);
      return;
    }
    setBusy(true);
    try {
      const { slug } = await createLeague({ name, visibility, ...checked.fields });
      // A season league's one round is made by the server; only event leagues add the prefilled event.
      // If that fails, the league still exists, and the dashboard tells the commissioner to add the round.
      const roundFailed = event && format === 'event' ? !(await addFirstRound(slug, event.key)) : false;
      window.location.assign(afterCreateUrl(slug, roundFailed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  // Big native-radio rows: the label wraps the input, so the whole row is the tap target.
  const OPTION =
    'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-checked:border-fg has-focus-visible:ring-2 has-focus-visible:ring-ring';
  const choice = (value: Visibility, label: string, hint: string) => (
    <label className={OPTION}>
      <input
        type="radio"
        name="visibility"
        value={value}
        checked={visibility === value}
        onChange={() => setVisibility(value)}
        className="mt-0.5 size-5 accent-primary"
      />
      <span>
        <span className="block font-semibold text-fg">{label}</span>
        <span className="block text-[13px] text-fg-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <Card title="Create a league" className="space-y-4">
      <form onSubmit={submit} className="space-y-4">
        <Input label="League name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-fg">Who can see it?</legend>
          {choice('link', 'Anyone with the link', 'Anyone with the link can watch')}
          {choice('members', 'Members only', 'Only members can see it')}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-fg">How do you want to play?</legend>
          {(
            [
              ['event', 'Event by event', 'Draft new teams for each event.'],
              ['season', 'Full season', 'Draft once and score every official event all year.'],
            ] as const
          ).map(([value, title, blurb]) => (
            <label key={value} className={OPTION}>
              <input
                type="radio"
                name="format"
                value={value}
                checked={format === value}
                onChange={() => setFormat(value)}
                className="mt-0.5 size-5 accent-primary"
              />
              <span>
                <span className="block font-semibold text-fg">{title}</span>
                <span className="block text-[13px] text-fg-muted">{blurb}</span>
              </span>
            </label>
          ))}
          <p className="text-[13px] text-fg-muted">You can&apos;t change this after the league is created.</p>
        </fieldset>

        {format === 'event' ? (
          // No inputMode="numeric": the iPhone number pad has no comma or space (same as FollowTeamsForm).
          <Input
            label="Follow teams (optional, up to 3)"
            value={follows}
            onChange={(e) => setFollows(e.target.value)}
            placeholder="5181"
            error={followsError}
            hint="Follow up to 3 teams and we'll add each event they attend automatically."
          />
        ) : (
          <div className="space-y-3">
            <Select label="Season" value={String(seasonYear)} onChange={(e) => changeSeasonYear(Number(e.target.value))}>
              {allowedSeasonYears(new Date()).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <PoolFilterFields year={seasonYear} value={poolFilter} onChange={setPoolFilter} />
          </div>
        )}

        {event && format === 'event' ? <p className="text-[15px] text-fg-muted">First round: {event.name}</p> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" busy={busy} disabled={name.trim() === ''}>
          Create a league
        </Button>
      </form>
    </Card>
  );
}
