import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EventData, TbaEvent } from '@/lib/tba/types';

function read<T>(eventKey: string, name: string): T {
  const file = path.join(process.cwd(), 'tests', 'fixtures', eventKey, `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function loadFixture(eventKey: string): EventData {
  return {
    teams: read(eventKey, 'teams'),
    matches: read(eventKey, 'matches'),
    rankings: read(eventKey, 'rankings'),
    alliances: read(eventKey, 'alliances'),
    awards: read(eventKey, 'awards'),
    oprs: read(eventKey, 'oprs'),
  };
}

export function loadFixtureEvent(eventKey: string): TbaEvent {
  return read<TbaEvent>(eventKey, 'event');
}
