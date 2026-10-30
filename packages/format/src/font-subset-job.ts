// One font subset job in a disposable worker with a watchdog (ADR-0051, M18.40): the host starts a fresh worker per
// font, posts the job, and terminates the worker when it answers, fails or overruns. A trap, a hang or memory
// exhaustion loses that font's subset only; the font keeps its original bytes. Pure and host-agnostic: the studio
// spawns a DOM Worker, the CLI a worker thread, both through the small shapes below, and the timers are injected.
import { type FontEngineModules, type FontEnginePorts, instantiateFontEngines } from './font-engines.js';
import { type FontSubsetInput, type FontSubsetOutcome, subsetFont } from './font-subset.js';

/** How long one font job may run before its worker is terminated. @public */
export const FONT_SUBSET_JOB_TIMEOUT_MS = 30_000;

/** The worker as the host side drives it (a DOM Worker or a worker_threads adapter). @public */
export type FontJobWorker = {
  /** Send the job. */
  postMessage(message: FontSubsetInput): void;
  /** Called with the worker's one answer. */
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  /** Called when the worker fails to start or throws. */
  onerror: ((event: unknown) => void) | null;
  /** Stop the worker and free its memory. */
  terminate(): void;
};

/** The worker's global scope as the job side uses it. @public */
export type FontJobScope = {
  /** Called with the posted job. */
  onmessage: ((event: { readonly data: FontSubsetInput }) => void) | null;
  /** Answer the job. */
  postMessage(message: FontSubsetOutcome): void;
};

const failure = (message: string): FontSubsetOutcome => ({ status: 'kept', reason: 'engine-failure', message });
const isOutcome = (v: unknown): v is FontSubsetOutcome =>
  typeof v === 'object' && v !== null && ((v as { status?: unknown }).status === 'subset' || (v as { status?: unknown }).status === 'kept');

/** Timers the watchdog uses; the host's own, so tests can drive time. @public */
export type JobTimers = {
  /** Schedule `run` after `ms`. */
  setTimeout(run: () => void, ms: number): unknown;
  /** Cancel a scheduled run. */
  clearTimeout(handle: unknown): void;
};

/**
 * Run one job in a fresh worker from `spawn` and terminate it afterwards. The outcome is the worker's answer, or
 * `engine-failure` when the worker cannot start, throws, answers something else or exceeds `timeoutMs`.
 * @public
 */
export function runFontSubsetJob(
  input: FontSubsetInput,
  spawn: () => FontJobWorker,
  timers: JobTimers,
  timeoutMs: number = FONT_SUBSET_JOB_TIMEOUT_MS,
): Promise<FontSubsetOutcome> {
  return new Promise((resolve) => {
    let worker: FontJobWorker | undefined;
    let done = false;
    const finish = (outcome: FontSubsetOutcome): void => {
      if (done) return;
      done = true;
      timers.clearTimeout(watchdog);
      worker?.terminate();
      resolve(outcome);
    };
    const watchdog = timers.setTimeout(() => finish(failure(`the font job took longer than ${timeoutMs / 1000} s and was stopped`)), timeoutMs);
    try {
      worker = spawn();
      worker.onmessage = (event) => finish(isOutcome(event.data) ? event.data : failure('the font worker answered something else'));
      worker.onerror = () => finish(failure('the font worker failed'));
      worker.postMessage(input);
    } catch {
      finish(failure('the font worker could not be started'));
    }
  });
}

/**
 * The job side: on the posted job, instantiate fresh pinned engines from `modules`, subset, and answer once. Engine
 * errors are answered as `engine-failure`; the host terminates the worker either way.
 * @public
 */
export function serveFontSubsetJob(scope: FontJobScope, modules: () => Promise<FontEngineModules>, ports: FontEnginePorts): void {
  scope.onmessage = (event) => {
    const run = async (): Promise<FontSubsetOutcome> => {
      const engines = await instantiateFontEngines(await modules(), ports);
      return subsetFont(event.data, engines, { sha256: ports.sha256 });
    };
    run().then(
      (outcome) => scope.postMessage(outcome),
      () => scope.postMessage(failure('the font engines could not be instantiated')),
    );
  };
}
