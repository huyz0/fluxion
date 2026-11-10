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
  /** How the owned termination (`kill()`) stands: a failed one ends the wait for exit after its failure window (2 s on Windows, none elsewhere). */
  private termination: 'none' | 'running' | 'done' | 'failed' = 'none';
  private failedAt: number | undefined;
  /** How long after a failed owned termination the exit may still be observed: 2 s for Windows' taskkill, 0 for a kill elsewhere. */
  private failureWindow = RESERVE_MS;
  /** Whether the two-second reserve has passed and the verdict now waits for the owned exit (an owned termination has started). */
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
  /**
   * One line on stderr naming why the reserve ended in a cleanup failure, and when (M18.195: diagnose before attempt 3), or that a
   * close succeeded only after the reserve (M18.201, every platform since M18.287), so each slow close shows in the ci log.
   */
  private trace(after?: 'exited-after-reserve') {
    const now = performance.now();
    const trace = {
      decided: after ?? (this.resource ? 'owned-not-exited' : 'launch-pending'),
      ...(after ? { closeToExitMs: Math.round(now - (this.deadline - RESERVE_MS)) } : {}),
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
        const resource = this.resource;
        if (!resource || resource.hasExited()) return undefined;
        // Windows' owned taskkill starts here (`immediate`), elsewhere the grace's kill follows an earlier close
        this.terminationStartedAt ??= performance.now();
        this.termination = 'running';
        // a failed taskkill may still have ended the tree, so Windows gives the exit two seconds; a kill that throws elsewhere decides
        this.failureWindow = resource.immediate === true ? RESERVE_MS : 0;
        return new Promise<void>((resolve) => resolve(resource.kill())).then(
          () => {
            this.termination = 'done';
          },
          () => {
            // a settled cleanup's `stop()` ends a running taskkill: its rejection decides nothing and arms no timer (M18.198)
            if (this.settled) return;
            this.termination = 'failed';
            this.failedAt = performance.now();
            // past the reserve, a failed termination gives the owned exit its failure window, not the lifecycle's end
            if (this.waiting) this.waitUntil(this.failedAt + this.failureWindow);
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
   * At the two-second reserve: an owned termination that has started (Windows' taskkill, or elsewhere the grace's kill after close)
   * and is still running or done waits for the owned exit until the session's lifecycle ends, since a starved host can take longer
   * than the reserve to end the process and report its exit (ci 40905801401 on Windows, nightly 42596642542 on Linux: M18.287); a
   * failed one waits its failure window (two seconds from the failure on Windows, none elsewhere); no termination started, or the
   * exit already observed, is decided now.
   */
  private atReserve = () => {
    if (this.settled) return;
    if (!this.resource || this.resource.hasExited() || this.termination === 'none') return this.decide();
    // a kill that failed elsewhere than Windows leaves nothing to wait for
    if (this.termination === 'failed' && this.failureWindow === 0) return this.decide();
    this.waiting = true;
    // a termination that failed may still have ended the process (taskkill's 255 with the exit just behind): two seconds from the failure
    this.waitUntil(this.failedAt === undefined ? this.lifecycleEnd : this.failedAt + this.failureWindow);
  };
  /** Decides at `at` (never past the lifecycle's end), after that turn's I/O, or now when `at` has passed. */
  private waitUntil(at: number) {
    clearTimeout(this.limit);
    const waitFor = Math.min(at, this.lifecycleEnd) - performance.now();
    if (waitFor <= 0) return void setImmediate(this.decide);
    this.limit = setTimeout(() => setImmediate(this.decide), waitFor);
  }
  private observe(resource: OwnedBrowserProcess): boolean {
    this.unsubscribe = resource.onExit(() => {
      if (this.waiting && !this.settled) this.trace('exited-after-reserve');
      this.finish(true);
    });
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
 * from now (ADR-0189: 120 s), which bounds the wait for the observed exit once an owned termination has started, on every platform
 * (M18.195 Windows, M18.287 elsewhere).
 */
export function createWitnessCleanup(options: { readonly lifecycleMs?: number } = {}): WitnessCleanup {
  return new CleanupCoordinator(options.lifecycleMs ?? 120000);
}
