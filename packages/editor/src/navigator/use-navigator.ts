// What the navigator does (FR-SCR-002, M8.12): drag to reorder, add, rename, hide, duplicate and delete, each one
// screen command (so one undo step), and the state of the gestures in progress.
import type { Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { type DragEvent, useMemo, useState } from 'react';
import type { MenuItem } from '../context-menu-model.js';
import type { Execute } from '../pointer.js';
import { switchScreen } from '../screen-switch.js';
import type { Session } from '../session.js';
import { dropMove, duplicateArgs, FORMAT_PREFIX, formatArgs, newScreen, type Row, SECTION_PREFIX } from './navigator-model.js';
import type { RowActions } from './screen-row.js';

/** What the hook needs. */
export type NavigatorInput = {
  readonly store: Store;
  readonly session: Session;
  readonly rows: readonly Row[];
  readonly execute: Execute | undefined;
  readonly newId: (() => RecordId) | undefined;
};

type Point = { readonly x: number; readonly y: number };

type MenuCtx = Omit<NavigatorInput, 'execute' | 'newId'> & { readonly execute: Execute; readonly newId: () => RecordId };

/** The section and format lines of a screen's menu, run on `target`. */
function runPlacement(command: string, target: RecordId, ctx: MenuCtx): void {
  const { rows, execute } = ctx;
  if (command.startsWith(SECTION_PREFIX)) {
    const to = command.slice(SECTION_PREFIX.length);
    execute('screen.setSection', { id: target, ...(to === 'none' ? {} : { sectionId: to }) });
    return;
  }
  const row = rows.find((r) => r.id === target);
  const args = formatArgs(command, target, { ...(row?.size ?? { w: 1920, h: 1080 }), infinite: row?.format === 'Infinite' });
  if (args !== undefined) execute('screen.setFormat', args);
}

/** A screen menu item other than rename, run on `target`. */
function runMenuItem(command: string, target: RecordId, ctx: MenuCtx): void {
  const { store, session, rows, execute, newId } = ctx;
  if (command === 'screen.setHidden') execute(command, { id: target, hidden: !(rows.find((r) => r.id === target)?.hidden ?? false) });
  else if (command === 'screen.duplicate') {
    const args = duplicateArgs(store, target, newId);
    if (execute(command, args).ok) switchScreen(session, args.newId);
  } else if (command === 'screen.delete' && rows.length > 1) execute(command, { id: target });
  else if (command.startsWith(SECTION_PREFIX) || command.startsWith(FORMAT_PREFIX)) runPlacement(command, target, ctx);
}

/** What the hook gives the panel. */
export type Navigator = {
  readonly renaming: RecordId | undefined;
  readonly sizing: RecordId | undefined;
  readonly dragging: RecordId | undefined;
  readonly menu: (Point & { readonly id: RecordId }) | undefined;
  readonly closeMenu: () => void;
  readonly actions: RowActions | undefined;
  readonly add: () => void;
  readonly pick: (item: MenuItem) => void;
};

/** The navigator's gestures and the actions its rows take (undefined without a way to run commands). */
export function useNavigator(input: NavigatorInput): Navigator {
  const { store, session, rows, execute, newId } = input;
  const [renaming, setRenaming] = useState<RecordId | undefined>(undefined);
  const [sizing, setSizing] = useState<RecordId | undefined>(undefined);
  const [dragging, setDragging] = useState<RecordId | undefined>(undefined);
  const [menu, setMenu] = useState<(Point & { readonly id: RecordId }) | undefined>(undefined);
  const actions = useMemo((): RowActions | undefined => {
    if (execute === undefined) return undefined;
    return {
      rename: (id, name) => void execute('screen.rename', { id, name }),
      setHidden: (id, hidden) => void execute('screen.setHidden', { id, hidden }),
      startRename: setRenaming,
      stopRename: () => {
        setRenaming(undefined);
        setSizing(undefined);
      },
      setSize: (id, size) => void execute('screen.setFormat', { id, format: { kind: 'fixed', size } }),
      dragStart: (id, e: DragEvent<HTMLLIElement>) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setDragging(id);
      },
      dragEnd: () => setDragging(undefined),
      drop: (target, e) => {
        e.preventDefault();
        const moved = dragging;
        setDragging(undefined);
        if (moved === undefined) return;
        const box = e.currentTarget.getBoundingClientRect();
        const move = dropMove(rows, moved, target, e.clientY > box.top + box.height / 2);
        // the place and the section go together: one command, one undo step
        if (move !== null) execute('screen.move', { id: moved, ...move });
      },
      menu: (id, at) => setMenu({ id, ...at }),
    };
  }, [execute, dragging, rows]);
  const add = () => {
    if (execute === undefined || newId === undefined) return;
    const id = newId();
    if (execute('screen.create', { screen: newScreen(store, id) }).ok) switchScreen(session, id);
  };
  const pick = (item: MenuItem) => {
    const target = menu?.id;
    setMenu(undefined);
    if (target === undefined || execute === undefined || newId === undefined) return;
    if (item.command === 'screen.rename') setRenaming(target);
    else if (item.command === `${FORMAT_PREFIX}custom`) setSizing(target);
    else runMenuItem(item.command, target, { ...input, execute, newId });
  };
  return { renaming, sizing, dragging, menu, closeMenu: () => setMenu(undefined), actions, add, pick };
}
