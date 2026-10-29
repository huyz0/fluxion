// Successive paint-witness sessions behind one importer port (ADR-0206, ADR-0189): a session admits at most 128 requests and lives
// 120 s, so a batch of up to 4096 members is witnessed by sessions replaced after 128 requests or 90 s, each disposed (its disposal
// checked) before the next starts. A session that cannot start or close stops the witnessing: later requests get no positive
// receipt and the failure is reported. Pure: the host injects how sessions start and the clock.

import { ok, type Result } from '@fluxion/schema';
import type { SvgPaintWitness } from './svg-import-types.js';

/** Requests per session: the witnesses' own cap. @public */
export const SESSION_REQUESTS = 128;
/** A session is replaced once this old, so a request (at most 10 s) ends well inside its 120 s lifetime. @public */
export const SESSION_AGE_MS = 90_000;

/** One started witness session, as the hosts' witnesses give it. @public */
export type WitnessSessionPort<F> = {
  /** The session's importer port. */
  readonly witness: SvgPaintWitness;
  /** Closes the session; a failure is reported, never taken as a clean close. */
  readonly dispose: () => Promise<Result<void, F>>;
};

/** Successive witness sessions behind one importer port. @public */
export type WitnessSessions<F> = {
  /** The importer port; a request after a failure is answered `unsupported`, never painted. */
  readonly witness: SvgPaintWitness;
  /** The first start, cleanup or later start failure, if any. */
  readonly failure: () => F | undefined;
  /** Disposes the open session, if any; its failure becomes `failure()`. */
  readonly dispose: () => Promise<void>;
};

/**
 * Sessions from `start`, the first started now; the start failure when even that one cannot start. `now` is the host's clock
 * in milliseconds; a session's age is counted from before its start, since its lifetime runs from before its browser launches.
 * @public
 */
export async function witnessSessions<F>(start: () => Promise<Result<WitnessSessionPort<F>, F>>, now: () => number): Promise<Result<WitnessSessions<F>, F>> {
  let startedAt = now();
  const first = await start();
  if (!first.ok) return first;
  let session: WitnessSessionPort<F> | undefined = first.value;
  let used = 0;
  let failure: F | undefined;
  const close = async () => {
    const open = session;
    session = undefined;
    const closed = open === undefined ? undefined : await open.dispose();
    if (closed !== undefined && !closed.ok && failure === undefined) failure = closed.error;
  };
  /** The session to use for the next request, replacing a full or old one; undefined once anything failed. */
  const current = async (): Promise<WitnessSessionPort<F> | undefined> => {
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
  return ok({ witness, failure: () => failure, dispose: close });
}
