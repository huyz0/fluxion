import type { OwnedBrowserProcess } from './svg-witness-process-types.js';

export type WitnessCleanup = {
  readonly close: () => Promise<boolean>;
  readonly own: (resource: OwnedBrowserProcess) => void;
  readonly launchStarted: () => void;
  readonly launchFinished: () => void;
};

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
  private force = () => {
    if (this.forced || !this.resource || this.resource.hasExited()) return;
    this.forced = true;
    void Promise.resolve()
      .then(() => (this.resource && !this.resource.hasExited() ? this.resource.kill() : undefined))
      .catch(() => {});
  };
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
      .then(() => (!this.settled && !resource.hasExited() ? resource.close() : undefined))
      .catch(() => {});
  }
  close = (): Promise<boolean> => {
    if (this.closing) return this.closing;
    this.closing = new Promise<boolean>((done) => {
      this.resolve = done;
    });
    this.deadline = performance.now() + 2000;
    this.limit = setTimeout(() => {
      const exited = this.resource ? this.resource.hasExited() : !this.pending;
      if (!exited) this.force();
      this.finish(exited);
    }, 2000);
    if (this.resource) this.shutdown();
    else if (!this.pending) this.finish(true);
    return this.closing;
  };
  own = (resource: OwnedBrowserProcess) => {
    if (this.resource) throw Error('witness already owns a browser process');
    this.resource = resource;
    if (this.closing) this.shutdown();
  };
  launchStarted = () => {
    this.pending = true;
  };
  launchFinished = () => {
    this.pending = false;
    if (this.closing && !this.resource) this.finish(true);
  };
}

/** One exit-based outcome and deadline include ownership arriving during cancelled startup. */
export function createWitnessCleanup(): WitnessCleanup {
  return new CleanupCoordinator();
}
