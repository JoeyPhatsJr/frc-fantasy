import type { NextConfig } from 'next';

// Cache Components is intentionally NOT enabled (spec §9.2).
// tba_cache in Postgres is the only cache layer.
const nextConfig: NextConfig = {};

export default nextConfig;
