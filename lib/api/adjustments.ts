import { z } from 'zod';
import { HttpError, UUID_RE } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { AdjustmentRow } from '@/lib/db/types';
import { TEAM_KEY_RE } from '@/lib/teams';

const POINTS_MESSAGE = 'Points must be a whole number from -1000 to 1000';

export const pointsField = z
  .number(POINTS_MESSAGE)
  .int(POINTS_MESSAGE)
  .min(-1000, POINTS_MESSAGE)
  .max(1000, POINTS_MESSAGE);

export const reasonField = z
  .string('A reason is required')
  .trim()
  .min(1, 'A reason is required')
  .max(200, 'The reason must be 200 characters or fewer');

export const playerIdField = z.string('Unknown player').regex(UUID_RE, 'Unknown player');

export const teamKeyField = z
  .string('Team keys look like frc341')
  .regex(TEAM_KEY_RE, 'Team keys look like frc341');

export const ONE_TARGET = 'Choose one target: a player or a team';

export async function assertLeaguePlayer(leagueId: string, playerId: string): Promise<void> {
  const players = await getRepo().listPlayers(leagueId);
  if (!players.some((p) => p.id === playerId)) throw new HttpError(400, 'Unknown player');
}

export type AdjustmentJson = {
  id: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};

export function toJson(row: AdjustmentRow): AdjustmentJson {
  return {
    id: row.id,
    playerId: row.playerId,
    teamKey: row.teamKey,
    points: row.points,
    reason: row.reason,
  };
}
