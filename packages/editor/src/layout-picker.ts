// The layout picker's model (FR-LAY-003, FR-LAY-010, M17.18): what a pick applies to and what it writes. A pick on one group or frame stores the layout
// on it (and "Make live" keeps it laid out as its children change); on the shown screen with nothing selected it stores it on the screen; on two or more
// selected elements it lays them out once. Each pick is one undo step: the spec write and the arrange it runs join (amend). Pure: no DOM, no React.
import { layoutTarget, type OptionWriter, type WrittenLayoutSpec } from './layout-options.js';

/**
 * What a pick applies to.
 *
 * @public
 */
export type PickTarget =
  | {
      /** A group or frame: its layout is stored on it. */
      readonly kind: 'container';
      /** The group or frame. */
      readonly id: string;
      /** Its layout spec, when it has one. */
      readonly spec?: WrittenLayoutSpec;
    }
  | {
      /** The shown screen: its layout is stored on it. */
      readonly kind: 'screen';
      /** The screen. */
      readonly id: string;
      /** Its layout spec, when it has one. */
      readonly spec?: WrittenLayoutSpec;
    }
  | {
      /** Two or more selected elements: laid out once, nothing stored. */
      readonly kind: 'selection';
      /** The selected elements. */
      readonly ids: readonly string[];
    };

/** The kinds of element that hold others and may carry a layout of their own. */
const CONTAINERS = new Set(['group', 'frame']);

/**
 * What the picker applies to for a selection on a screen: the one selected group or frame, the screen when nothing is selected, or the selected
 * elements when there are two or more; nothing for one selected shape (it has nothing to lay out).
 *
 * @public
 */
export function pickTarget(get: (id: string) => unknown, selection: readonly string[], screenId: string | undefined): PickTarget | undefined {
  if (screenId === undefined) return undefined;
  if (selection.length > 1) return { kind: 'selection', ids: selection };
  const [only] = selection;
  if (only === undefined) return withSpec({ kind: 'screen', id: screenId }, get, []);
  const kind = (get(only) as { readonly kind?: unknown } | undefined)?.kind;
  return typeof kind === 'string' && CONTAINERS.has(kind) ? withSpec({ kind: 'container', id: only }, get, selection) : undefined;
}

/** The target with the layout spec it already has, if any. */
function withSpec(
  target: { readonly kind: 'container' | 'screen'; readonly id: string },
  get: (id: string) => unknown,
  selection: readonly string[],
): PickTarget {
  const spec = layoutTarget(get, selection, target.id)?.spec;
  return spec === undefined ? target : { ...target, spec };
}

/**
 * The type of the layout a target has (`template` for a built template), or none.
 *
 * @public
 */
export function chosenLayout(target: PickTarget): string {
  return target.kind === 'selection' ? '' : (target.spec?.type ?? '');
}

/**
 * Apply the layout `algorithm`. A group, frame or screen keeps it (its options start from the layout's defaults; "live" stays as it was), then is laid
 * out by it; selected elements are laid out once. False when the document refused the spec or the layout; the arrange of a stored layout may refuse
 * on its own (nothing to lay out) and the spec stays.
 *
 * @public
 */
export function pickLayout(execute: OptionWriter, target: PickTarget, at: { readonly screenId: string; readonly algorithm: string }): boolean {
  const { screenId, algorithm } = at;
  if (target.kind === 'selection') return execute('layout.arrange', { screenId, scope: 'selection', selection: target.ids, algorithm }).ok;
  const layout = { type: algorithm, ...(target.spec?.['live'] === true ? { live: true } : {}) };
  const container = target.kind === 'container'; // kind-switch-allow: a pick target is a container, the screen or a selection, a closed set
  const written = container ? execute('element.update', { id: target.id, fields: { layout } }) : execute('screen.setLayout', { id: target.id, layout });
  if (!written.ok) return false;
  const scope = container ? { containerId: target.id } : 'screen';
  execute('layout.arrange', { screenId, scope, algorithm }, { amend: true });
  return true;
}

/**
 * Whether the target can be made live: a group or frame that has a layout (a live layout is laid out again as its children change, FR-LAY-010).
 *
 * @public
 */
export function canBeLive(target: PickTarget): boolean {
  return target.kind === 'container' && target.spec !== undefined; // kind-switch-allow: only a container is made live
}

/**
 * Make the layout of a group or frame live, or not. False when the target cannot be live or the document refused.
 *
 * @public
 */
export function setLive(execute: OptionWriter, target: PickTarget, live: boolean): boolean {
  if (!canBeLive(target) || target.kind !== 'container' || target.spec === undefined) return false; // kind-switch-allow: narrowing a container
  const { live: _was, ...rest } = target.spec;
  const layout = live ? { ...rest, live: true } : rest;
  return execute('element.update', { id: target.id, fields: { layout } }).ok;
}
