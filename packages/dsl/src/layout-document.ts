// Lay out a whole document with a registered algorithm, through the arrange command (FR-LAY-001, FR-CLI-002): the engine behind `fluxion layout`.
import { type CoreRegistries, createStore } from '@fluxion/core';
import { arrangeCommand, type LayoutAlgorithm } from '@fluxion/layout';
import type { Diagnostic, DocumentFile } from '@fluxion/schema';

/**
 * What {@link layoutDocument} gives back: the arranged document, or why it could not.
 *
 * @public
 */
export type LaidOut =
  | {
      /** The layout succeeded. */
      readonly ok: true;
      /** The document with its screens arranged. */
      readonly document: DocumentFile;
      /** How many screens were arranged. */
      readonly screens: number;
    }
  | {
      /** The layout failed; the document is unchanged. */
      readonly ok: false;
      /** Why. */
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * The document with every screen that has elements arranged by `algorithm` (a container with a layout of its own keeps it), or why a screen
 * could not be. A screen without elements is left alone.
 *
 * @public
 */
export function layoutDocument(doc: DocumentFile, registries: CoreRegistries, algorithm = 'layered'): LaidOut {
  const store = createStore(doc);
  const arrange = arrangeCommand((name) => registries.layouts.get(name) as LayoutAlgorithm<never> | undefined);
  let screens = 0;
  for (const id of store.members('byType', 'screen')) {
    if (store.members('byScreen', id).length === 0) continue;
    const run = arrange.run({ store }, { screenId: id, scope: 'screen', algorithm });
    if (!run.ok) return { ok: false, diagnostics: run.error.diagnostics };
    screens += 1;
  }
  return { ok: true, document: store.toDocument(), screens };
}
