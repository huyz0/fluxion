// The canvas's context menus (FR-EDT-013, M7.25): what is under the point decides the menu (an element, a screen, the
// canvas), the element there is selected first, and the choice runs as an editor command.
import type { Box } from '@fluxion/geometry';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import type { MenuAsked } from './canvas.js';
import { ContextMenu } from './context-menu.js';
import { type MenuItem, menuItems, menuTarget } from './context-menu-model.js';
import { EDITOR_COMMANDS, type EditorCommand } from './editor-commands.js';
import type { KeyBinding } from './keymap.js';
import type { KeyOverrides } from './keymap-overrides.js';
import { shortcutsOf } from './palette-model.js';
import type { ToolDispatcher } from './tools.js';

/** What {@link useCanvasMenu} reads. */
export type CanvasMenuInput = {
  /** The tools, whose hit test says what is under the point. */
  readonly tools: ToolDispatcher;
  /** The shown screen's area on the page. */
  readonly area: Box | undefined;
  /** Run an editor command by id. */
  readonly run: (command: string) => boolean;
  /** The keymap before rebindings, and the user's rebindings. */
  readonly base: readonly KeyBinding[];
  readonly overrides: KeyOverrides;
  /** Editor commands besides the built-in ones. */
  readonly commands: readonly EditorCommand[] | undefined;
  /** Whether the page runs on a Mac. */
  readonly mac: boolean;
};

/** An open menu: where, and what it lists. */
type Open = { readonly at: MenuAsked['client']; readonly items: readonly MenuItem[] };

/** The canvas's menu: `onMenu` for the canvas, and the menu to render while one is open. */
export function useCanvasMenu(input: CanvasMenuInput): { readonly onMenu: (asked: MenuAsked) => void; readonly menu: ReactNode } {
  const { tools, area, run, base, overrides, commands, mac } = input;
  const [open, setOpen] = useState<Open | undefined>(undefined);
  const all = useMemo(() => [...EDITOR_COMMANDS, ...(commands ?? [])], [commands]);
  const onMenu = useCallback(
    (asked: MenuAsked) => {
      const { session, hitTest } = tools.ctx;
      const hit = hitTest(asked.page);
      // the right-clicked element is what the menu acts on, unless it is part of the selection already
      if (hit !== undefined && !session.selection.get().includes(hit)) session.selection.set([hit]);
      setOpen({ at: asked.client, items: menuItems(menuTarget(hit, asked.page, area), all) });
    },
    [tools, area, all],
  );
  const close = useCallback(() => setOpen(undefined), []);
  const menu =
    open === undefined ? null : (
      <ContextMenu
        items={open.items}
        at={open.at}
        keysOf={(command) => shortcutsOf(base, overrides, { command }, mac)}
        onPick={(item) => {
          // closed first, so a command that opens a dialog finds the menu gone
          close();
          run(item.command);
        }}
        onClose={close}
      />
    );
  return { onMenu, menu };
}
