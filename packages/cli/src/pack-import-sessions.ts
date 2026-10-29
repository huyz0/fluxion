// The paint witness of a `pack-import` (ADR-0206): one Node session admits at most 128 requests and lives 120 s (ADR-0189), so a
// batch of up to 4096 members is witnessed by successive sessions, each disposed (and its disposal checked) before the next starts.
// A session that cannot start or close stops the witnessing: later requests get no positive receipt and the failure is reported.

import type { SvgPaintWitness } from '@fluxion/format';
import type { Result } from '@fluxion/schema';
import type { NodeSvgWitnessFailure, NodeSvgWitnessSession } from './svg-witness-types.js';

/** Requests per session: the Node witness's own cap. */
export const SESSION_REQUESTS = 128;
/** A session is replaced once this old, so a request (at most 10 s) ends well inside its 120 s lifetime. */
export const SESSION_AGE_MS = 90_000;

/** Successive witness sessions behind one importer port. */
export type WitnessSessions = {
  /** The importer port; a request after a failure is answered `unsupported`, never painted. */
  readonly witness: SvgPaintWitness;
  /** The first start, cleanup or later start failure, if any. */
  readonly failure: () => NodeSvgWitnessFailure | undefined;
  /** Disposes the open session, if any; its failure becomes `failure()`. */
  readonly dispose: () => Promise<void>;
};

/** Sessions from `start`, the first started now; the start failure when even that one cannot start. */
export async function witnessSessions(
  start: () => Promise<Result<NodeSvgWitnessSession, NodeSvgWitnessFailure>>,
  now: () => number = Date.now,
): Promise<WitnessSessions | NodeSvgWitnessFailure> {
  // a session's lifetime runs from before its browser launches, so its age is counted from before `start`
  let startedAt = now();
  const first = await start();
  if (!first.ok) return first.error;
  let session: NodeSvgWitnessSession | undefined = first.value;
  let used = 0;
  let failure: NodeSvgWitnessFailure | undefined;
  const close = async () => {
    const open = session;
    session = undefined;
    const closed = open === undefined ? undefined : await open.dispose();
    if (closed !== undefined && !closed.ok) failure ??= closed.error;
  };
  /** The session to use for the next request, replacing a full or old one; undefined once anything failed. */
  const current = async (): Promise<NodeSvgWitnessSession | undefined> => {
    if (session !== undefined && used < SESSION_REQUESTS && now() - startedAt < SESSION_AGE_MS) return session;
    await close();
    if (failure !== undefined) return undefined;
    const launched = now();
    const next = await start();
    if (!next.ok) failure = next.error;
    else [session, used, startedAt] = [next.value, 0, launched];
    return session;
  };
  const witness: SvgPaintWitness = async (request) => {
    const open = failure === undefined ? await current() : undefined;
    if (open === undefined) return { identity: request.identity, status: 'unsupported', fontHashes: [] };
    used++;
    return open.witness(request);
  };
  return { witness, failure: () => failure, dispose: close };
}
