/** Internal adapter: only the BrowserServer launched for this witness may be stopped. */
export type OwnedBrowserProcess = {
  readonly hasExited: () => boolean;
  readonly onExit: (listener: () => void) => () => void;
  readonly close: () => Promise<void>;
  readonly kill: () => Promise<void>;
  readonly stop?: () => void;
};
export type BrowserProcessOwner = { readonly close: () => Promise<boolean> };
