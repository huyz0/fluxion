import type { OwnedBrowserProcess } from './svg-witness-process-types.js';

export type WitnessCleanup = {
  readonly close: () => Promise<boolean>;
  /** What is left of the session's lifecycle, at least the two-second reserve: the bound of an owned termination helper. */
  readonly remaining: () => number;
  readonly own: (resource: OwnedBrowserProcess) => void;
  readonly launchStarted: () => void;
  readonly launchFinished: () => void;
};

/** ADR-0189's cleanup reserve: the wait for an observed exit after close, and after a failed owned termination. */
const RESERVE_MS = 2000;

class CleanupCoordinator implements WitnessCleanup {
  private resource: OwnedBrowserProcess | undefined;
  private pending = false;
  private settled = false;
  private shuttingDown = false;
  private forced = false;
  private closing: Promise<boolean> | undefined;
  private resolve = (_success: boolean) => {};
  private deadline = 0;
  private limit: ReturnType<typeof setTimeout> | undefined;
  private grace: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe = () => {};
  /** When the owned termination first started (`resource.close()`, or `kill()` when it comes first), for the cleanup-failure trace (M18.195). */
  private terminationStartedAt: number | undefined;
  /** How an `immediate` owned termination stands: a failed one ends the wait for exit two seconds after it failed. */
  private termination: 'none' | 'running' | 'done' | 'failed' = 'none';
  private failedAt: number | undefined;
  /** Whether the two-second reserve has passed and the verdict now waits for the owned exit (an `immediate` termination only). */
  private waiting = false;
  /** The end of the session's lifecycle (ADR-0189: 120 s from creation, its final 2 s reserved for cleanup). */
  private readonly lifecycleEnd: number;

  constructor(lifecycleMs: number) {
    this.lifecycleEnd = performance.now() + lifecycleMs;
  }

  private finish(success: boolean) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.limit);
    clearTimeout(this.grace);
    this.unsubscribe();
    try {
      this.resource?.stop?.();
    } catch {
      /* Preserve the observed browser exit verdict. */
    }
    this.resolve(success);
  }
  /** One line on stderr naming why the reserve ended in a cleanup failure, and when (M18.195: diagnose before attempt 3). */
  private trace() {
    const now = performance.now();
    const trace = {
      decided: this.resource ? 'owned-not-exited' : 'launch-pending',
      sinceTerminationMs: this.terminationStartedAt === undefined ? null : Math.round(now - this.terminationStartedAt),
      expiryToVerdictMs: Math.round(now - this.deadline),
      forced: this.forced,
      waitedForExit: this.waiting,
      termination: this.termination,
      helper: this.resource?.diagnostics?.() ?? null,
      platform: process.platform,
    };
    process.stderr.write(`WITNESS_CLEANUP ${JSON.stringify(trace)}\n`);
  }
  private force = () => {
    if (this.forced || !this.resource || this.resource.hasExited()) return;
    this.forced = true;
    void Promise.resolve()
      .then(() => {
        if (!this.resource || this.resource.hasExited()) return undefined;
        // Windows' owned taskkill starts here (`immediate`), elsewhere the grace's kill follows an earlier close
        this.terminationStartedAt ??= performance.now();
        const immediate = this.resource.immediate === true;
        if (immediate) this.termination = 'running';
        return this.resource.kill().then(
          () => {
            if (immediate) this.termination = 'done';
          },
          (cause: unknown) => {
            if (!immediate) throw cause;
            // a settled cleanup's `stop()` ends a running taskkill: its rejection decides nothing and arms no timer (M18.198)
            if (this.settled) return;
            this.termination = 'failed';
            this.failedAt = performance.now();
            // past the reserve, a failed termination gives the owned exit two seconds from the failure, not the lifecycle's end
            if (this.waiting) this.waitUntil(this.failedAt + RESERVE_MS);
          },
        );
      })
      .catch(() => {});
  };
  /** The verdict: a clean close only when the owned exit has been observed (or no launch is left pending). */
  private decide = () => {
    if (this.settled) return;
    const exited = this.resource ? this.resource.hasExited() : !this.pending;
    if (!exited) {
      this.trace();
      this.force();
    }
    this.finish(exited);
  };
  /**
   * At the two-second reserve: an `immediate` (Windows) owned termination still running or done waits for the owned exit until
   * the session's lifecycle ends, since a starved host can take longer than the reserve to end the tree and report its exit
   * (ci 40905801401); a failed one waits two seconds from its failure; every other case is decided now.
   */
  private atReserve = () => {
    if (this.settled) return;
    if (!this.resource?.immediate || this.resource.hasExited()) return this.decide();
    this.waiting = true;
    // a termination that failed may still have ended the tree (taskkill's 255 with the exit just behind): two seconds from the failure
    this.waitUntil(this.failedAt === undefined ? this.lifecycleEnd : this.failedAt + RESERVE_MS);
  };
  /** Decides at `at` (never past the lifecycle's end), after that turn's I/O, or now when `at` has passed. */
  private waitUntil(at: number) {
    clearTimeout(this.limit);
    const waitFor = Math.min(at, this.lifecycleEnd) - performance.now();
    if (waitFor <= 0) return void setImmediate(this.decide);
    this.limit = setTimeout(() => setImmediate(this.decide), waitFor);
  }
  private observe(resource: OwnedBrowserProcess): boolean {
    this.unsubscribe = resource.onExit(() => this.finish(true));
    if (this.settled) {
      this.unsubscribe();
      return false;
    }
    if (resource.hasExited()) {
      this.finish(true);
      return false;
    }
    return true;
  }
  private shutdown() {
    const resource = this.resource;
    if (!resource || this.shuttingDown) return;
    this.shuttingDown = true;
    if (resource.hasExited()) {
      this.finish(true);
      return;
    }
    // Late launch still belongs to us; terminating it cannot rewrite the earlier failure.
    if (this.settled) {
      this.force();
      return;
    }
    if (!this.observe(resource)) return;
    if (resource.immediate) {
      this.force();
      return;
    }
    this.grace = setTimeout(this.force, Math.min(1000, Math.max(0, this.deadline - performance.now() - 1000)));
    void Promise.resolve()
      .then(() => {
        if (this.settled || resource.hasExited()) return undefined;
        this.terminationStartedAt = performance.now();
        return resource.close();
      })
      .catch(() => {});
  }
  close = (): Promise<boolean> => {
    if (this.closing) return this.closing;
    this.closing = new Promise<boolean>((done) => {
      this.resolve = done;
    });
    this.deadline = performance.now() + RESERVE_MS;
    // The verdict is read after the loop's I/O of this turn: a starved host runs the expired reserve before an exit that
    // already happened, and reading it then would report a clean close as a cleanup failure (ci 40858059983).
    this.limit = setTimeout(() => setImmediate(this.atReserve), RESERVE_MS);
    if (this.resource) this.shutdown();
    else if (!this.pending) this.finish(true);
    return this.closing;
  };
  own = (resource: OwnedBrowserProcess) => {
    if (this.resource) throw Error('witness already owns a browser process');
    this.resource = resource;
    if (this.closing) this.shutdown();
  };
  // whole milliseconds: Node's spawn refuses a fractional `timeout` (ERR_OUT_OF_RANGE), which would fail every owned taskkill
  remaining = (): number => Math.max(RESERVE_MS, Math.floor(this.lifecycleEnd - performance.now()));
  launchStarted = () => {
    this.pending = true;
  };
  launchFinished = () => {
    this.pending = false;
    if (this.closing && !this.resource) this.finish(true);
  };
}

/**
 * One exit-based outcome and deadline include ownership arriving during cancelled startup. `lifecycleMs` is the session's lifetime
 * from now (ADR-0189: 120 s), which bounds the wait for an owned Windows termination.
 */
export function createWitnessCleanup(options: { readonly lifecycleMs?: number } = {}): WitnessCleanup {
  return new CleanupCoordinator(options.lifecycleMs ?? 120000);
}
