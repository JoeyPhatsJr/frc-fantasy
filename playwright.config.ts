import { defineConfig } from '@playwright/test';

// Loads E2E_AUTH_SECRET and the Supabase keys for the test's own seeding. Next.js reads .env.local itself.
try {
  process.loadEnvFile('.env.local');
} catch {
  // CI would pass real env vars instead.
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 360, height: 780 },
    trace: 'retain-on-failure',
  },
  webServer: {
    // A production build, the way phones will see it. VERCEL is unset locally, so the test login works.
    command: 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100',
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
