import { cache } from 'react';
import { getRepo } from '@/lib/db';

/**
 * The user's leagues, read once per server render (React cache()): the root layout's live-draft pill, the
 * league layout's Switch chip and Home/Leagues/You all need them. Outside a server render it is a plain call.
 */
export const listMyLeagues = cache((userId: string) => getRepo().listLeaguesForUser(userId));
