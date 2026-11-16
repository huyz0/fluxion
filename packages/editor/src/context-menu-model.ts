// The context menus' model (FR-EDT-013, M7.25): where a menu was asked for decides which it is, and each menu is a
// list of editor commands. Pure: the menu component (context-menu.tsx) shows it.
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { ALIGN_MODES, DISTRIBUTE_AXES, FLIP_AXES, ORDER_MOVES } from './arrange-edit.js';
import { BOOLEAN_OPS } from './boolean-edit.js';
import type { EditorCommand } from './editor-commands.js';
import { LAYOUT_CHOICES } from './layout-arrange.js';
import { TABLE_MENU } from './table-commands.js';
import { commandTitle } from './titles.js';

/**
 * Which menu: on an element, on the one selected table, on a screen's own area, or on the canvas around the screens.
 *
 * @public
 */
export type MenuTarget = 'canvas' | 'element' | 'table' | 'screen';

/**
 * One line of a context menu: an editor command, titled.
 *
 * @public
 */
export type MenuItem = {
  /** The editor command it runs. */
  readonly command: string;
  /** What the menu shows. */
  readonly title: string;
};

/** The Arrange lines of the element menu: align, distribute, order, flip and the boolean operations. */
const ARRANGE = [
  ...ALIGN_MODES.map(([m]) => `selection.align.${m}`),
  ...DISTRIBUTE_AXES.map(([a]) => `selection.distribute.${a}`),
  ...ORDER_MOVES.map(([t]) => `selection.order.${t}`),
  ...FLIP_AXES.map(([a]) => `selection.flip.${a}`),
  // the boolean operations (FR-SHP-010, M19.18)
  ...BOOLEAN_OPS.map(([o]) => `selection.boolean.${o}`),
  // the layout lines (M13.16)
  ...LAYOUT_CHOICES.map(([n]) => `layout.arrange.selection.${n}`),
  'layout.arrange.container',
  'layout.tidy',
  'layout.fit',
];

/** The element menu's lines. */
const ELEMENT = [
  'clipboard.cut',
  'clipboard.copy',
  'clipboard.duplicate',
  'selection.delete',
  'selection.sameType',
  'selection.sameStyle',
  // the format painter (FR-ARR-007)
  'selection.copyStyle',
  'selection.pasteStyle',
  'selection.group',
  'selection.ungroup',
  // a master's element made a placeholder or an ordinary element again (FR-SCR-005)
  'master.makePlaceholder',
  'master.clearPlaceholder',
  // the Arrange lines (M8.26)
  ...ARRANGE,
];

/** The commands of each menu, in order. */
const MENUS: { readonly [T in MenuTarget]: readonly string[] } = {
  element: ELEMENT,
  // the table's rows, columns and cells first (FR-SHP-014, M19.21), then the element lines
  table: [...TABLE_MENU, ...ELEMENT],
  screen: [
    'clipboard.paste',
    'selection.all',
    'camera.fitScreen',
    'master.edit',
    'master.close',
    ...LAYOUT_CHOICES.map(([n]) => `layout.arrange.screen.${n}`),
    'layout.tidy',
    'layout.fit',
  ],
  canvas: ['clipboard.paste', 'camera.fitScreen', 'camera.zoom100'],
};

/**
 * The menu asked for at the page point `page`: the element `hit` there, else the screen if the point is inside its
 * `area`, else the canvas.
 *
 * @public
 */
export function menuTarget(hit: RecordId | undefined, page: Vec2, area: Box | undefined): MenuTarget {
  if (hit !== undefined) return 'element';
  const inside = area !== undefined && page.x >= area.x && page.y >= area.y && page.x <= area.x + area.w && page.y <= area.y + area.h;
  return inside ? 'screen' : 'canvas';
}

/**
 * The items of the `target` menu, titled by the editor commands they run (one no command is registered for is left out).
 *
 * @public
 */
export function menuItems(target: MenuTarget, commands: readonly EditorCommand[]): readonly MenuItem[] {
  const titles = new Map(commands.map((c) => [c.id, commandTitle(c)]));
  // the Arrange lines of registered layouts (a plugin's) follow the built-in ones
  const prefix = target === 'element' || target === 'table' ? 'layout.arrange.selection.' : target === 'screen' ? 'layout.arrange.screen.' : undefined;
  const added = prefix === undefined ? [] : [...titles.keys()].filter((id) => id.startsWith(prefix) && !MENUS[target].includes(id));
  return [...MENUS[target], ...added].flatMap((command): MenuItem[] => {
    const title = titles.get(command);
    return title === undefined ? [] : [{ command, title }];
  });
}
