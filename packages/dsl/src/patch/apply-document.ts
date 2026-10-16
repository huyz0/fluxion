// Apply an AI patch to a whole document (ADR-0035, FR-AI-003): the engine behind `fluxion patch`. It runs `ai.applyPatch` on a store made from the
// document, so the patch is validated, laid out and applied exactly as in the studio, and rejected whole when it does not apply.
import { type CoreRegistries, createStore } from '@fluxion/core';
import type { Diagnostic, DocumentFile } from '@fluxion/schema';
import { type AppliedPatch, applyPatchCommand } from './apply.js';

/**
 * What {@link patchDocument} gives back: the patched document and what the patch did, or why it was rejected.
 *
 * @public
 */
export type Patched =
  | {
      /** The patch applied. */
      readonly ok: true;
      /** The document after the patch. */
      readonly document: DocumentFile;
      /** What the patch did. */
      readonly applied: AppliedPatch;
    }
  | {
      /** The patch was rejected; the document is unchanged. */
      readonly ok: false;
      /** Why: `FLX_PATCH_*` diagnostics. */
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Apply `patch` (the plain or the strict form) to `doc`.
 *
 * @public
 */
export function patchDocument(doc: DocumentFile, patch: unknown, registries: CoreRegistries): Patched {
  const store = createStore(doc);
  const run = applyPatchCommand(registries).run({ store }, { patch });
  if (!run.ok) return { ok: false, diagnostics: run.error.diagnostics };
  return { ok: true, document: store.toDocument(), applied: run.value as AppliedPatch };
}
