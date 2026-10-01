'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { PoolFilter } from '@/lib/season/poolFilter';

export function poolFilterLabel(f: PoolFilter): string {
  switch (f.type) {
    case 'all':
      return 'All teams';
    case 'district':
      return `District ${f.key}`;
    case 'state':
      return `${f.state}, ${f.country}`;
    case 'country':
      return f.country;
  }
}

/** True when two filters are the same, ignoring key order (Postgres jsonb reorders keys). */
export function samePoolFilter(a: PoolFilter, b: PoolFilter): boolean {
  const canon = (f: PoolFilter) => JSON.stringify(f, Object.keys(f).sort());
  return canon(a) === canon(b);
}

/** Controlled fields for a season pool filter (spec §5.5). Used on /leagues/new and in round setup. */
export function PoolFilterFields({
  year,
  value,
  onChange,
  disabled,
}: {
  year: number;
  value: PoolFilter;
  onChange: (f: PoolFilter) => void;
  disabled?: boolean;
}) {
  const [districts, setDistricts] = useState<{ key: string; name: string }[] | null>(null);
  useEffect(() => {
    if (value.type !== 'district') return;
    let cancelled = false;
    setDistricts(null);
    fetch(`/api/districts/${year}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { districts: [] }))
      .then((body: { districts: { key: string; name: string }[] }) => {
        if (!cancelled) setDistricts(body.districts);
      })
      .catch(() => {
        if (!cancelled) setDistricts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [value.type, year]);

  return (
    <div className="space-y-3">
      <Select
        label="Which teams"
        value={value.type}
        disabled={disabled}
        onChange={(e) => {
          const type = e.target.value as PoolFilter['type'];
          if (type === 'all') onChange({ type });
          if (type === 'district') onChange({ type, key: '' });
          if (type === 'state') onChange({ type, country: 'USA', state: '' });
          if (type === 'country') onChange({ type, country: '' });
        }}
      >
        <option value="all">All teams</option>
        <option value="district">One district</option>
        <option value="state">One state or province</option>
        <option value="country">One country</option>
      </Select>
      {value.type === 'district' ? (
        districts === null ? (
          <p className="text-[15px] text-fg-muted">Loading districts…</p>
        ) : districts.length === 0 ? (
          <p className="text-[15px] text-fg-muted">No districts are listed for {year} yet.</p>
        ) : (
          <Select
            label="District"
            value={value.key}
            disabled={disabled}
            onChange={(e) => onChange({ type: 'district', key: e.target.value })}
          >
            <option value="">Pick a district</option>
            {districts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </Select>
        )
      ) : null}
      {value.type === 'state' || value.type === 'country' ? (
        <Input
          label="Country"
          value={value.country}
          disabled={disabled}
          maxLength={60}
          hint="As The Blue Alliance writes it, e.g. USA, Canada, Israel"
          onChange={(e) => onChange({ ...value, country: e.target.value })}
        />
      ) : null}
      {value.type === 'state' ? (
        <Input
          label="State or province"
          value={value.state}
          disabled={disabled}
          maxLength={60}
          hint="Full name, e.g. Pennsylvania, Ontario"
          onChange={(e) => onChange({ ...value, state: e.target.value })}
        />
      ) : null}
    </div>
  );
}
