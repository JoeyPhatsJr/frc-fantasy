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
  .refine((s) => !CONTROL_RE.test(s), "Names can't contain control characters");

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
