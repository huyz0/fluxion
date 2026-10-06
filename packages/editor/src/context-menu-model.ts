// The context menus' model (FR-EDT-013, M7.25): where a menu was asked for decides which it is, and each menu is a
// list of editor commands. Pure: the menu component (context-menu.tsx) shows it.
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { ALIGN_MODES, DISTRIBUTE_AXES, ORDER_MOVES } from './arrange-edit.js';
import type { EditorCommand } from './editor-commands.js';
import { commandTitle } from './titles.js';

/**
 * Which menu: on an element, on a screen's own area, or on the canvas around the screens.
 *
 * @public
 */
export type MenuTarget = 'canvas' | 'element' | 'screen';

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

/** The Arrange lines of the element menu: align, distribute and order. */
const ARRANGE = [
  ...ALIGN_MODES.map(([m]) => `selection.align.${m}`),
  ...DISTRIBUTE_AXES.map(([a]) => `selection.distribute.${a}`),
  ...ORDER_MOVES.map(([t]) => `selection.order.${t}`),
];

/** The commands of each menu, in order. */
const MENUS: { readonly [T in MenuTarget]: readonly string[] } = {
  element: [
    'clipboard.cut',
    'clipboard.copy',
    'clipboard.duplicate',
    'selection.delete',
    'selection.sameType',
    'selection.sameStyle',
    'selection.group',
    'selection.ungroup',
    // the Arrange lines (M8.26)
    ...ARRANGE,
  ],
  screen: ['clipboard.paste', 'selection.all', 'camera.fitScreen'],
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
  return MENUS[target].flatMap((command): MenuItem[] => {
    const title = titles.get(command);
    return title === undefined ? [] : [{ command, title }];
  });
}
