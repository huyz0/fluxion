// The layout picker's model (FR-LAY-003, FR-LAY-010, M17.18): what a pick applies to and what it writes. A pick on one group or frame stores the layout
// on it (and "Make live" keeps it laid out as its children change); on the shown screen with nothing selected it stores it on the screen; on two or more
// selected elements it lays them out once. Each pick is one undo step: the spec write and the arrange it runs join (amend). Pure: no DOM, no React.
import { APPLY_PATCH_COMMAND_ID } from '@fluxion/dsl';
import type { RecordId } from '@fluxion/schema';
import type { ArrangePort, ArrangeRequest, ArrangeScope } from './layout-arrange.js';
import { layoutTarget, type OptionWriter, type WrittenLayoutSpec } from './layout-options.js';

/**
 * The prefix of a picker choice that is a template: `template:process.basic`.
 *
 * @public
 */
export const TEMPLATE_CHOICE = 'template:';

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
 * The picker choice a target's layout is: the layout's type, or `template:<id>` for a built template.
 *
 * @public
 */
export function chosenChoice(target: PickTarget): string {
  const type = chosenLayout(target);
  const id = target.kind === 'selection' ? undefined : target.spec?.['id']; // kind-switch-allow: a selection has no stored layout
  return type === 'template' && typeof id === 'string' ? `${TEMPLATE_CHOICE}${id}` : type;
}

/**
 * The ids of the templates a registry lists, sorted (M17.37): the entries whose value carries an `id`.
 *
 * @public
 */
export function registeredTemplateIds(entries: readonly (readonly [string, unknown])[]): readonly string[] {
  const ids = entries.flatMap(([key, value]) => (typeof (value as { id?: unknown } | null)?.id === 'string' ? [key] : []));
  return [...new Set(ids)].sort();
}

type Labelled = {
  readonly type?: string;
  readonly kind?: string;
  readonly parentId?: unknown;
  readonly index?: string;
  readonly semantic?: { readonly label?: unknown };
  readonly text?: unknown;
};

/** The plain text of a rich text document: its text leaves, one block per line. */
function plain(node: unknown): string {
  const n = node as { readonly text?: unknown; readonly content?: readonly unknown[] } | undefined;
  if (typeof n?.text === 'string') return n.text;
  return (n?.content ?? []).map(plain).join('');
}

/**
 * One item of a template built from the screen's shapes: the shape and its label.
 *
 * @public
 */
export type ScreenItem = {
  /** The shape the item comes from. */
  readonly id: string;
  /** Its label: the item's text. */
  readonly label: string;
};

/**
 * The items of a template built from a screen's shapes (M17.37): the label (else the text) of each top-level shape and group on the screen, in
 * order; shapes with neither give nothing. Connectors are not items.
 *
 * @public
 */
export function screenItems(get: (id: string) => unknown, ids: readonly string[]): readonly ScreenItem[] {
  const rows = ids.flatMap((id) => {
    const r = get(id) as Labelled | undefined;
    if (r?.type !== 'element' || r.kind === 'connector' || r.parentId !== undefined) return [];
    const label = typeof r.semantic?.label === 'string' ? r.semantic.label : plain(r.text);
    return label.trim() === '' ? [] : [{ id, index: r.index ?? '', label: label.trim() }];
  });
  return rows.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)).map(({ id, label }) => ({ id, label }));
}

/**
 * Build the template `templateId` into the shown screen from `items`, in one patch (one undo step): the shapes the items come from are replaced by
 * the template's own, so nothing is drawn twice. False when there are no items, the target is not the screen, or the document refused.
 *
 * @public
 */
export function pickTemplate(execute: OptionWriter, target: PickTarget, at: { readonly templateId: string; readonly items: readonly ScreenItem[] }): boolean {
  if (target.kind !== 'screen' || at.items.length === 0) return false; // kind-switch-allow: a template is built into a screen only
  const layout = { type: 'template', id: at.templateId, items: at.items.map(({ label }) => ({ label })) };
  const removes = at.items.map(({ id }) => ({ op: 'remove', target: `#${id}`, cascade: true }));
  return execute(APPLY_PATCH_COMMAND_ID, { patch: { flux: 1, ops: [...removes, { op: 'setLayout', scope: `#${target.id}`, layout }] } }).ok;
}

/** Lay out through the host's port when it has one (its worker), else with the command on the page's thread. */
function arrangeWith(execute: OptionWriter, arrange: ArrangePort | undefined, request: ArrangeRequest, amend: boolean): boolean {
  const join = amend ? ({ amend: true } as const) : undefined;
  if (arrange === undefined) return execute('layout.arrange', request, join).ok || amend;
  void arrange({ ...request, ...join }).catch(() => undefined);
  return true;
}

/**
 * Apply the layout `algorithm`. A group, frame or screen keeps it (its options start from the layout's defaults; "live" stays as it was), then is laid
 * out by it; selected elements are laid out once. False when the document refused the spec or the layout; the arrange of a stored layout may refuse
 * on its own (nothing to lay out) and the spec stays.
 *
 * @public
 */
export function pickLayout(
  execute: OptionWriter,
  target: PickTarget,
  at: { readonly screenId: string; readonly algorithm: string },
  arrange?: ArrangePort,
): boolean {
  const screenId = at.screenId as RecordId;
  const { algorithm } = at;
  if (target.kind === 'selection') {
    const selection = target.ids as readonly RecordId[];
    return arrangeWith(execute, arrange, { screenId, scope: 'selection', selection, algorithm }, false);
  }
  const layout = { type: algorithm, ...(target.spec?.['live'] === true ? { live: true } : {}) };
  const container = target.kind === 'container'; // kind-switch-allow: a pick target is a container, the screen or a selection, a closed set
  const written = container ? execute('element.update', { id: target.id, fields: { layout } }) : execute('screen.setLayout', { id: target.id, layout });
  if (!written.ok) return false;
  const scope: ArrangeScope = container ? { containerId: target.id as RecordId } : 'screen';
  return arrangeWith(execute, arrange, { screenId, scope, algorithm }, true);
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
