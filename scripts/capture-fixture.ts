// Downloads every TBA endpoint the app uses for one event into tests/fixtures/<eventKey>/.
// Usage: npx tsx --env-file=.env.local scripts/capture-fixture.ts 2025parr
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://www.thebluealliance.com/api/v3';

const FILES: Record<string, string> = {
  event: '',
  teams: '/teams/simple',
  matches: '/matches/simple',
  rankings: '/rankings',
  alliances: '/alliances',
  awards: '/awards',
  oprs: '/oprs',
};

async function main() {
  const eventKey = (process.argv[2] ?? '').trim().toLowerCase();
  if (!/^[0-9]{4}[a-z0-9]+$/.test(eventKey)) {
    throw new Error('Usage: capture-fixture.ts <eventKey>   e.g. 2025parr');
  }
  const apiKey = process.env.TBA_API_KEY;
  if (!apiKey) throw new Error('TBA_API_KEY is not set. Put it in .env.local.');

  const dir = path.join(process.cwd(), 'tests', 'fixtures', eventKey);
  await mkdir(dir, { recursive: true });

  for (const [name, suffix] of Object.entries(FILES)) {
    const url = `${BASE}/event/${eventKey}${suffix}`;
    const res = await fetch(url, { headers: { 'X-TBA-Auth-Key': apiKey }, cache: 'no-store' });
    let body: unknown = null;
    if (res.status === 200) body = await res.json();
    else if (res.status !== 404) throw new Error(`${url} returned HTTP ${res.status}`);
    await writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
    const size = Array.isArray(body) ? `${body.length} items` : body === null ? 'no data' : 'object';
    console.log(`${name}.json  (${size})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
