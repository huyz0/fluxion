// The `.flux` loader (FR-FIL-009, NFR-REL-002; architecture/08 §2): the container half (`loader-core.ts`) with the validating document reader, which
// migrates, repairs and validates, and salvages a cut-off or partly invalid `document.json` and opens a newer major version read-only (`document-open.ts`, M10.7).
import type { Result } from '@fluxion/schema';
import { openDocumentText } from './document-open.js';
import type { FormatError } from './errors.js';
import { type LoadedFlux, type LoadOptions, loadFluxWith } from './loader-core.js';

export type { LoadedFlux, LoadedManifest, LoadOptions } from './loader-core.js';

/**
 * Open the `.flux` file `bytes`. Never throws: a file that cannot open is an error with a stable code; one that opens with damage carries
 * `notes` and `diagnostics`.
 *
 * @public
 */
export function loadFlux(bytes: Uint8Array, options: LoadOptions): Promise<Result<LoadedFlux, FormatError>> {
  return loadFluxWith(bytes, options, openDocumentText);
}
