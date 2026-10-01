import { z } from 'zod';

const place = (what: string) =>
  z
    .string(`${what} is required`)
    .trim()
    .min(1, `${what} is required`)
    .max(60, `${what} must be 60 characters or fewer`);

/** Which teams a season round can draft (spec §5.5). Stored as jsonb in rounds.pool_filter. */
export const poolFilterSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('all') }),
  z.strictObject({
    type: z.literal('district'),
    key: z.string('District is required').regex(/^[0-9]{4}[a-z0-9]+$/, 'District keys look like 2027fma'),
  }),
  z.strictObject({ type: z.literal('state'), country: place('Country'), state: place('State') }),
  z.strictObject({ type: z.literal('country'), country: place('Country') }),
]);

export type PoolFilter = z.infer<typeof poolFilterSchema>;

export const DEFAULT_POOL_FILTER: PoolFilter = { type: 'all' };
