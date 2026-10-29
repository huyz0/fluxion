// The paint witness of a `pack-import` (ADR-0206): one Node session admits at most 128 requests and lives 120 s (ADR-0189), so a
// batch of up to 4096 members is witnessed by successive sessions. The rotation is format's `witnessSessions` (M18.174), here
// on the process clock; a session that cannot start or close stops the witnessing and the failure is reported.

import { type WitnessSessions as Rotating, witnessSessions as rotate } from '@fluxion/format';
import type { Result } from '@fluxion/schema';
import type { NodeSvgWitnessFailure, NodeSvgWitnessSession } from './svg-witness-types.js';

export { SESSION_AGE_MS, SESSION_REQUESTS } from '@fluxion/format';

/** Successive witness sessions behind one importer port. */
export type WitnessSessions = Rotating<NodeSvgWitnessFailure>;

/** Sessions from `start`, the first started now; the start failure when even that one cannot start. */
export async function witnessSessions(
  start: () => Promise<Result<NodeSvgWitnessSession, NodeSvgWitnessFailure>>,
  now: () => number = Date.now,
): Promise<WitnessSessions | NodeSvgWitnessFailure> {
  const sessions = await rotate(start, now);
  return sessions.ok ? sessions.value : sessions.error;
}
