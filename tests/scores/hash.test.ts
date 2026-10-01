import { describe, expect, it } from 'vitest';
import type { CacheMeta } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { bodyHash, canonicalJson, configHash, SCORES_VERSION, sha256Hex, sourceStamp, sourceStampOfBodies } from '@/lib/scores/hash';

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it('drops undefined object values and writes undefined array items as null, like JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 2] })).toBe('{"b":[null,2]}');
  });

  it('handles plain values', () => {
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(1.5)).toBe('1.5');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('bodyHash', () => {
  it('is null for no data', () => {
    expect(bodyHash(null)).toBeNull();
    expect(bodyHash(undefined)).toBeNull();
  });

  // Review Focus 1: Postgres jsonb hands keys back in its own order, and a TBA 304 re-saves the
  // body read from the database. The hash must not change, or every 304 would force a re-score.
  it('is the same when the same JSON comes back with its keys reordered', () => {
    const fromTba = { rankings: [{ rank: 1, team_key: 'frc341', record: { wins: 5, losses: 0, ties: 0 } }], extra_stats_info: [] };
    const fromJsonb = { extra_stats_info: [], rankings: [{ record: { ties: 0, losses: 0, wins: 5 }, team_key: 'frc341', rank: 1 }] };
    expect(bodyHash(fromJsonb)).toBe(bodyHash(fromTba));
  });

  it('changes when a value changes', () => {
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }));
  });
});

describe('configHash', () => {
  it('is stable across key order and changes with any point value', () => {
    const a = defaultScoring();
    // Same values, top-level keys in reverse insertion order.
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    const b = defaultScoring();
    b.qualWin += 1;
    expect(configHash(a)).toHaveLength(64);
    expect(configHash(reordered)).toBe(configHash(a));
    expect(configHash(b)).not.toBe(configHash(a));
  });
});

describe('SCORES_VERSION', () => {
  // Final review I2: a scoring, cleaning or serializer change bumps the version, so every cached
  // event_scores row is keyed differently and gets re-scored instead of served from old code.
  it('is part of the config hash, so bumping it changes every key', () => {
    const c = defaultScoring();
    expect(Number.isInteger(SCORES_VERSION)).toBe(true);
    expect(configHash(c)).toBe(configHash(c, SCORES_VERSION));
    expect(configHash(c, SCORES_VERSION + 1)).not.toBe(configHash(c));
    expect(configHash(c)).toBe(sha256Hex(canonicalJson({ v: SCORES_VERSION, config: c })));
  });
});

describe('sourceStamp', () => {
  const meta = (path: string, hash: string | null): CacheMeta => ({
    path,
    fetchedAt: '2026-10-24T12:00:00.000Z',
    bodyHash: hash,
    lastErrorAt: null,
  });
  const paths = ['/a', '/b'];

  it('depends on each path hash, in the given path order', () => {
    const one = sourceStamp(paths, new Map([['/a', meta('/a', 'h1')], ['/b', meta('/b', null)]]));
    const two = sourceStamp(paths, new Map([['/a', meta('/a', 'h1')], ['/b', meta('/b', 'h2')]]));
    expect(one).toHaveLength(64);
    expect(two).not.toBe(one);
  });

  it('ignores fetch times (a 304 refresh keeps the stamp)', () => {
    const early = new Map([['/a', meta('/a', 'h1')], ['/b', meta('/b', 'h2')]]);
    const late = new Map([['/a', { ...meta('/a', 'h1'), fetchedAt: '2026-10-25T00:00:00.000Z' }], ['/b', meta('/b', 'h2')]]);
    expect(sourceStamp(paths, late)).toBe(sourceStamp(paths, early));
  });

  it('is null when any path has never been cached', () => {
    expect(sourceStamp(paths, new Map([['/a', meta('/a', 'h1')]]))).toBeNull();
  });
});

describe('sourceStampOfBodies', () => {
  const paths = ['/a', '/b'];
  const meta = (path: string, body: unknown): CacheMeta => ({
    path, fetchedAt: '2026-10-24T12:00:00.000Z', bodyHash: bodyHash(body), lastErrorAt: null,
  });

  it('equals the metadata stamp when the bodies are the cached ones (so a hit follows the miss)', () => {
    const a = { x: 1 };
    const fromMeta = sourceStamp(paths, new Map([['/a', meta('/a', a)], ['/b', meta('/b', null)]]));
    expect(sourceStampOfBodies(paths, new Map<string, unknown>([['/a', { x: 1 }], ['/b', null]]))).toBe(fromMeta);
  });

  it('is null when a path has never been cached, and changes with any body', () => {
    expect(sourceStampOfBodies(paths, new Map([['/a', { x: 1 }]]))).toBeNull();
    const one = sourceStampOfBodies(paths, new Map<string, unknown>([['/a', { x: 1 }], ['/b', null]]));
    const two = sourceStampOfBodies(paths, new Map<string, unknown>([['/a', { x: 2 }], ['/b', null]]));
    expect(two).not.toBe(one);
  });
});
