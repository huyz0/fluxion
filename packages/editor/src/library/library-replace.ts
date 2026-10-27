// Replacing the selected shape from the library (FR-LIB-011, M18.37): the one selected shape takes the picked
// definition through core's shape.replace, which keeps its box, text, style and connectors; one undo step. The
// definitions' anchors come from the registry, since a command sees only the store.
import type { ReadView, Registry, ShapeDef } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import type { Execute } from '../pointer.js';
import type { Session } from '../session.js';

/**
 * What replacing needs.
 *
 * @public
 */
export type ReplaceDeps = {
  /** The document, to read. */
  readonly view: ReadView;
  /** Run a command. */
  readonly execute: Execute;
  /** The selection to replace. */
  readonly session: Session;
  /** Where definitions are looked up. */
  readonly shapeDefs: Registry<string, ShapeDef>;
};

type Shape = { readonly type?: unknown; readonly kind?: unknown; readonly defId?: unknown };

/**
 * The selected shape a pick would replace: the selection's only element when it is a shape, else undefined.
 *
 * @public
 */
export function replaceableShape(view: ReadView, selection: readonly RecordId[]): RecordId | undefined {
  if (selection.length !== 1) return undefined;
  const id = selection[0] as RecordId;
  const r = view.get(id) as Shape | undefined;
  return r?.type === 'element' && r.kind === 'shape' ? id : undefined;
}

/**
 * Give the selected shape definition `defId`. False when no single shape is selected, the definition is unknown, it is
 * the shape's own already, or the document refuses.
 *
 * @public
 */
export function replaceSelectedShape(deps: ReplaceDeps, defId: string): boolean {
  const id = replaceableShape(deps.view, deps.session.selection.get());
  const to = deps.shapeDefs.get(defId);
  if (id === undefined || to === undefined) return false;
  const current = (deps.view.get(id) as Shape).defId;
  if (current === defId) return false;
  const from = typeof current === 'string' ? deps.shapeDefs.get(current) : undefined;
  const ok = deps.execute('shape.replace', { id, defId, fromAnchors: from?.anchors ?? [], toAnchors: to.anchors ?? [] }).ok;
  if (ok) deps.session.library.set(defId);
  return ok;
}
