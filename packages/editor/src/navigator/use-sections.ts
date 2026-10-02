// What the navigator does with sections (FR-SCR-004, M8.15): fold, rename, add, move up or down, delete, and take a
// dropped screen, each one section command (so one undo step).
import type { RecordId } from '@fluxion/schema';
import { useMemo, useState } from 'react';
import type { MenuItem } from '../context-menu-model.js';
import type { Execute } from '../pointer.js';
import type { SectionRow } from './navigator-model.js';
import type { SectionActions } from './section-header.js';

/** What the hook needs. */
export type SectionsInput = {
  readonly sections: readonly SectionRow[];
  readonly execute: Execute | undefined;
  readonly newId: (() => RecordId) | undefined;
  /** The screen being dragged, if one. */
  readonly dragging: RecordId | undefined;
};

type Point = { readonly x: number; readonly y: number };

/** The lines of a section's menu. */
export const SECTION_ITEMS: readonly MenuItem[] = [
  { command: 'section.rename', title: 'Rename section' },
  { command: 'section.up', title: 'Move section up' },
  { command: 'section.down', title: 'Move section down' },
  { command: 'section.delete', title: 'Delete section' },
];

/** What the hook gives the panel. */
export type Sections = {
  readonly renaming: RecordId | undefined;
  readonly menu: (Point & { readonly id: RecordId }) | undefined;
  readonly closeMenu: () => void;
  readonly actions: SectionActions | undefined;
  readonly add: () => void;
  readonly pick: (item: MenuItem) => void;
};

/** The `after` that puts section `id` one place up (`null`: already first) or down (`null`: already last). */
export function movedTo(sections: readonly SectionRow[], id: RecordId, step: -1 | 1): { readonly after?: RecordId } | null {
  const at = sections.findIndex((s) => s.id === id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= sections.length) return null;
  // up: after the one before that; down: after the one below
  const after = step === -1 ? sections[to - 1]?.id : sections[to]?.id;
  return after === undefined ? {} : { after };
}

/** A section menu line other than rename, run on `target`. */
function runSectionItem(command: string, target: RecordId, ctx: { readonly sections: readonly SectionRow[]; readonly execute: Execute }): void {
  if (command === 'section.delete') {
    ctx.execute('section.delete', { id: target });
    return;
  }
  const move = movedTo(ctx.sections, target, command === 'section.up' ? -1 : 1);
  if (move !== null) ctx.execute('section.reorder', { id: target, ...move });
}

/** The sections' gestures and the actions their headers take. */
export function useSections(input: SectionsInput): Sections {
  const { sections, execute, newId, dragging } = input;
  const [renaming, setRenaming] = useState<RecordId | undefined>(undefined);
  const [menu, setMenu] = useState<(Point & { readonly id: RecordId }) | undefined>(undefined);
  const actions = useMemo((): SectionActions | undefined => {
    if (execute === undefined) return undefined;
    return {
      toggle: (id, collapsed) => void execute('section.setCollapsed', { id, collapsed }),
      rename: (id, name) => void execute('section.rename', { id, name }),
      startRename: setRenaming,
      stopRename: () => setRenaming(undefined),
      drop: (id, e) => {
        e.preventDefault();
        if (dragging !== undefined) execute('screen.setSection', { id: dragging, sectionId: id });
      },
      menu: (id, at) => setMenu({ id, ...at }),
    };
  }, [execute, dragging]);
  const add = () => {
    if (execute === undefined || newId === undefined) return;
    const last = sections.at(-1)?.id;
    execute('section.create', { id: newId(), name: `Section ${sections.length + 1}`, ...(last === undefined ? {} : { after: last }) });
  };
  const pick = (item: MenuItem) => {
    const target = menu?.id;
    setMenu(undefined);
    if (target === undefined || execute === undefined) return;
    if (item.command === 'section.rename') setRenaming(target);
    else runSectionItem(item.command, target, { sections, execute });
  };
  return { renaming, menu, closeMenu: () => setMenu(undefined), actions, add, pick };
}
