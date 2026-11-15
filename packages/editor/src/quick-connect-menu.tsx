// The quick-connect mini library (FR-EDT-015): where a quick-connect drag was dropped on nothing, a menu of shapes to add there
// joined to the first (the same shape as it, then a few basic ones) and Connector only; Esc or a press elsewhere adds nothing.
import { useValue } from '@fluxion/render';
import { t } from '@lingui/core/macro';
import './i18n.js';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from './context-menu.js';
import type { MenuItem } from './context-menu-model.js';
import type { ShapeDefs } from './param-handles.js';
import { finishQuickDrop, sameAs } from './quick-connect.js';
import type { QuickDrop } from './session.js';
import type { ToolDispatcher } from './tools.js';

/** The basic shapes the mini library offers after the source's own, by definition id. */
export const QUICK_SHAPES: readonly string[] = ['basic:rect', 'basic:rounded-rect', 'basic:ellipse', 'basic:diamond'];

const SAME = 'quick.same';
const NONE = 'quick.none';
const PREFIX = 'quick.shape:';

/** The titles of the basic shapes offered. */
const titleOf = (defId: string): string =>
  (
    ({
      'basic:rect': () => t`Rectangle`,
      'basic:rounded-rect': () => t`Rounded rectangle`,
      'basic:ellipse': () => t`Ellipse`,
      'basic:diamond': () => t`Diamond`,
    }) as { readonly [id: string]: () => string }
  )[defId]?.() ?? defId;

/** The mini library's lines for `drop`: the source's own shape, each offered shape `defs` holds, and the connector alone. */
export function quickItems(defs: ShapeDefs, hasSame: boolean): readonly MenuItem[] {
  return [
    ...(hasSame ? [{ command: SAME, title: t`Same shape` }] : []),
    ...QUICK_SHAPES.filter((id) => defs.get(id) !== undefined).map((id) => ({ command: `${PREFIX}${id}`, title: titleOf(id) })),
    { command: NONE, title: t`Connector only` },
  ];
}

/** Run the mini library's line `command` for `drop`. */
export function pickQuick(tools: ToolDispatcher, defs: ShapeDefs, drop: QuickDrop, command: string): void {
  const ctx = tools.ctx;
  if (command === SAME) {
    finishQuickDrop(ctx, drop, sameAs(ctx.view, drop.source));
    return;
  }
  const def = command.startsWith(PREFIX) ? defs.get(command.slice(PREFIX.length)) : undefined;
  finishQuickDrop(ctx, drop, def === undefined ? undefined : { defId: def.id, size: def.defaultSize });
}

const NO_KEYS = (): readonly string[] => [];

/** Props of {@link QuickConnectMenu}. */
export type QuickConnectMenuProps = {
  /** The tools whose context the choice writes through. */
  readonly tools: ToolDispatcher;
  /** Where the offered shapes are looked up. */
  readonly shapeDefs: ShapeDefs;
  /** The canvas, whose box places the menu. */
  readonly canvas: RefObject<HTMLElement | null>;
};

/** The mini library, open while a quick-connect drop waits for a choice. */
export function QuickConnectMenu(props: QuickConnectMenuProps): ReactNode {
  const { tools, shapeDefs, canvas } = props;
  const session = tools.ctx.session;
  const drop = useValue(session.quickDrop.get);
  const box = canvas.current?.getBoundingClientRect();
  if (drop === undefined || box === undefined) return null;
  // in the editor's root, not inside the canvas: the canvas's pointer input would take a press on a line as a press on the
  // canvas, and the root carries the chrome's colours and focus ring
  const host = canvas.current?.closest('.fx-editor') ?? document.body;
  return createPortal(
    <ContextMenu
      label={t`Add a shape`}
      items={quickItems(shapeDefs, sameAs(tools.ctx.view, drop.source) !== undefined)}
      at={{ x: box.left + drop.screen.x, y: box.top + drop.screen.y }}
      keysOf={NO_KEYS}
      onPick={(item) => pickQuick(tools, shapeDefs, drop, item.command)}
      onClose={() => session.quickDrop.set(undefined)}
    />,
    host,
  );
}
