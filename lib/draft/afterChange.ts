import { advance } from '@/lib/draft/advance';
import { ring } from '@/lib/realtime/doorbell';

/**
 * Run after a live-draft change is saved: auto-pick for anyone on auto-draft (§7.4), then ring the doorbell
 * (§7.5). The change is already committed, so an advance() failure (a database blip) is logged, not thrown:
 * the caller still answers with success, and the ring always goes out so other phones refetch. The next
 * trigger (a pick, a tick, a resume) runs advance() again. Returns the auto-picks made (0 on failure).
 */
export async function afterDraftChange(
  roundId: string,
  now: Date,
  opts: { advance?: boolean } = {},
): Promise<number> {
  try {
    return opts.advance === false ? 0 : await advance(roundId, now);
  } catch (err) {
    console.error('advance failed after a saved draft change', err);
    return 0;
  } finally {
    await ring(roundId);
  }
}
