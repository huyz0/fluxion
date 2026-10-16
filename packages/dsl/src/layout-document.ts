// Lay out a whole document with a registered algorithm, through the arrange command (FR-LAY-001, FR-CLI-002): the engine behind `fluxion layout`.
import { type CoreRegistries, createStore, type Store } from '@fluxion/core';
import { arrangeCommand, buildSnapshot, type LayoutAlgorithm, type Scorecard, type SnapshotRecord, scoreLayout } from '@fluxion/layout';
import type { Diagnostic, DocumentFile } from '@fluxion/schema';

/**
 * The scorecard of one arranged screen.
 *
 * @public
 */
export type ScreenScore = Scorecard & {
  /** The record id of the screen. */
  readonly screen: string;
};

/** The elements of a screen and every binding, as the layout snapshot reads them. */
function recordsOf(store: Store, screenId: string): SnapshotRecord[] {
  const ids = [...store.members('byScreen', screenId), ...store.members('byType', 'binding')];
  return ids.map((id) => store.get(id)).filter((r) => r !== undefined) as unknown as SnapshotRecord[];
}

/** The layout input of a whole screen as the store has it now. */
const snapshotOf = (store: Store, screen: string) => buildSnapshot(recordsOf(store, screen), { screenId: screen, scope: 'screen' });

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
      /** The scorecard of each arranged screen, in screen order: the result measured against the screen as it was before. */
      readonly scores: readonly ScreenScore[];
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
  const scores: ScreenScore[] = [];
  for (const id of store.members('byType', 'screen')) {
    if (store.members('byScreen', id).length === 0) continue;
    const before = snapshotOf(store, id);
    const run = arrange.run({ store }, { screenId: id, scope: 'screen', algorithm });
    if (!run.ok) return { ok: false, diagnostics: run.error.diagnostics };
    const after = snapshotOf(store, id);
    scores.push({ screen: id, ...scoreLayout(before, Object.fromEntries(after.nodes.map((n) => [n.id, n.box]))) });
  }
  return { ok: true, document: store.toDocument(), screens: scores.length, scores };
}
