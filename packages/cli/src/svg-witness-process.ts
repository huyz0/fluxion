/** Internal adapter: only the BrowserServer launched for this witness may be stopped. */
export type OwnedBrowserProcess = {
  readonly hasExited: () => boolean;
  readonly onExit: (listener: () => void) => () => void;
  readonly close: () => Promise<void>;
  readonly kill: () => Promise<void>;
};
export type BrowserProcessOwner = { readonly close: () => Promise<boolean> };

/** Observe exit independently of Playwright's close/kill promises; never wait past the reserve. */
export function ownBrowserProcess(process: OwnedBrowserProcess): BrowserProcessOwner {
  let closing: Promise<boolean> | undefined;
  const close = (): Promise<boolean> => {
    if (closing) return closing;
    closing = new Promise<boolean>((resolve) => {
      if (process.hasExited()) {
        resolve(true);
        return;
      }
      let done = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let limit: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};
      const finish = (success: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(grace);
        clearTimeout(limit);
        unsubscribe();
        resolve(success);
      };
      unsubscribe = process.onExit(() => finish(true));
      if (done) {
        unsubscribe();
        return;
      }
      if (process.hasExited()) {
        finish(true);
        return;
      }
      // Register deadlines before invoking external operations: even a synchronous
      // failure or a never-settling close/kill cannot remove the cleanup bound.
      grace = setTimeout(() => {
        if (process.hasExited()) {
          finish(true);
          return;
        }
        void Promise.resolve()
          .then(() => {
            return !done && !process.hasExited() ? process.kill() : undefined;
          })
          .catch(() => {});
      }, 1000);
      limit = setTimeout(() => finish(process.hasExited()), 2000);
      void Promise.resolve()
        .then(() => {
          return !done && !process.hasExited() ? process.close() : undefined;
        })
        .catch(() => {});
    });
    return closing;
  };
  return { close };
}
