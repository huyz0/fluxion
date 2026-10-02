// Putting a library item on the canvas (FR-LIB-002, M8.18): a click inserts it at the middle of the view, a drop at the
// drop point; either way it has the definition's default size, is selected, and is one undo step. The item also
// becomes the library's current one, which the shape tool (R) places.
import type { Registry, ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { type CreateDeps, createElement, shapeMaker } from '../create-tool.js';

/** The drag data type a library item carries: the definition id. */
export const LIBRARY_DRAG_TYPE = 'application/x-fluxion-shape';

/** What inserting needs besides what any creation needs: where definitions are looked up. */
export type InsertDeps = CreateDeps & { readonly shapeDefs: Registry<string, ShapeDef> };

/**
 * Add a shape of definition `defId` centred on `centre` (page units) at its default size. The new id, or undefined
 * when the definition is unknown or nothing could be added.
 */
export function insertShape(deps: InsertDeps, defId: string, centre: Vec2): RecordId | undefined {
  const def = deps.shapeDefs.get(defId);
  if (def === undefined) return undefined;
  const { w, h } = def.defaultSize;
  const id = createElement(deps, { x: centre.x - w / 2, y: centre.y - h / 2, w, h }, shapeMaker(defId));
  if (id !== undefined) deps.session.library.set(defId);
  return id;
}
