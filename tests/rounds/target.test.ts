import { describe, expect, it } from 'vitest';
import { targetRound, type TargetCandidate } from '@/lib/rounds/target';

const TODAY = '2026-10-20';

const r = (id: string, startDate: string, status: TargetCandidate['status']): TargetCandidate => ({
  id,
  startDate,
  status,
});

describe('targetRound', () => {
  it('is null when there are no rounds', () => {
    expect(targetRound([], TODAY)).toBeNull();
  });

  it('a live round wins over everything else', () => {
    const rounds = [
      r('old', '2026-03-01', 'final'),
      r('live', '2026-10-19', 'live'),
      r('next', '2026-10-24', 'upcoming'),
    ];
    expect(targetRound(rounds, TODAY)).toBe('live');
  });

  it('with two live rounds, picks the earlier-starting one', () => {
    const rounds = [r('b', '2026-10-20', 'live'), r('a', '2026-10-18', 'live')];
    expect(targetRound(rounds, TODAY)).toBe('a');
  });

  it('with nothing live, picks the soonest upcoming, drafting or setup round', () => {
    const rounds = [
      r('final', '2026-09-01', 'final'),
      r('later', '2026-11-14', 'setup'),
      r('soon', '2026-10-24', 'drafting'),
      r('mid', '2026-11-01', 'upcoming'),
    ];
    expect(targetRound(rounds, TODAY)).toBe('soon');
  });

  it('prefers a pending round in the future over one stuck in the past', () => {
    const rounds = [r('stale', '2026-02-01', 'setup'), r('next', '2026-10-24', 'upcoming')];
    expect(targetRound(rounds, TODAY)).toBe('next');
  });

  it('falls back to the most recent past pending round when none is in the future', () => {
    const rounds = [r('older', '2026-02-01', 'setup'), r('newer', '2026-06-01', 'setup'), r('f', '2026-09-01', 'final')];
    expect(targetRound(rounds, TODAY)).toBe('newer');
  });

  it('counts a pending round starting today as upcoming', () => {
    const rounds = [r('today', TODAY, 'upcoming'), r('later', '2026-10-30', 'upcoming')];
    expect(targetRound(rounds, TODAY)).toBe('today');
  });

  it('otherwise picks the latest round by start date', () => {
    const rounds = [
      r('a', '2026-03-01', 'final'),
      r('c', '2026-10-10', 'awaiting_final'),
      r('b', '2026-06-01', 'final'),
    ];
    expect(targetRound(rounds, TODAY)).toBe('c');
  });

  it('does not depend on input order', () => {
    const rounds = [r('x', '2026-10-24', 'upcoming'), r('y', '2026-10-22', 'setup')];
    expect(targetRound(rounds, TODAY)).toBe('y');
    expect(targetRound([...rounds].reverse(), TODAY)).toBe('y');
  });
});
