/** Internal structural ports keep the optional browser peer out of Node/T0 type imports. */
export type Page = {
  readonly setContent: (html: string, options: { timeout: number }) => Promise<void>;
  readonly evaluate: <T, A>(callback: (argument: A) => T | Promise<T>, argument: A) => Promise<T>;
};
export type BrowserContext = {
  readonly route: (pattern: string, handler: (route: { abort: () => Promise<void> }) => Promise<void>) => Promise<void>;
  readonly newPage: () => Promise<Page>;
  readonly close: () => Promise<void>;
};
export type Browser = {
  readonly newContext: (options: { acceptDownloads: false; serviceWorkers: 'block' }) => Promise<BrowserContext>;
};
export type BrowserServer = {
  readonly wsEndpoint: () => string;
  readonly process: () => {
    readonly pid?: number;
    readonly exitCode: number | null;
    readonly signalCode: string | null;
    readonly once: (event: 'exit', listener: () => void) => unknown;
    readonly removeListener: (event: 'exit', listener: () => void) => unknown;
    /** Ends this one process directly (TerminateProcess on Windows), without Playwright's synchronous taskkill. */
    readonly kill: (signal: 'SIGKILL') => boolean;
  };
  readonly close: () => Promise<void>;
  readonly kill: () => Promise<void>;
};
