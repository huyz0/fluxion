/** Internal adapter: only the BrowserServer launched for this witness may be stopped. */
export type OwnedBrowserProcess = {
  readonly hasExited: () => boolean;
  readonly onExit: (listener: () => void) => () => void;
  readonly close: () => Promise<void>;
  readonly kill: () => Promise<void>;
  readonly immediate?: boolean;
  readonly stop?: () => void;
  /** What the owned termination helper did, for the cleanup-failure trace (M18.195). */
  readonly diagnostics?: () => Readonly<Record<string, unknown>>;
};
export type BrowserProcessOwner = { readonly close: () => Promise<boolean> };
