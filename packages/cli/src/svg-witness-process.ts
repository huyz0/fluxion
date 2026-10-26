import { createWitnessCleanup, type WitnessCleanup } from './svg-witness-cleanup.js';

import type { BrowserProcessOwner, OwnedBrowserProcess } from './svg-witness-process-types.js';

export type { BrowserProcessOwner, OwnedBrowserProcess } from './svg-witness-process-types.js';

/** Controller and process owner join the same bounded, observed-exit outcome. */
export function ownBrowserProcess(process: OwnedBrowserProcess, cleanup: WitnessCleanup = createWitnessCleanup()): BrowserProcessOwner {
  cleanup.own(process);
  return { close: cleanup.close };
}
