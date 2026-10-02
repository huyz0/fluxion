import { describe, expect, it } from 'vitest';
import { menuItems, menuTarget } from './context-menu-model.js';
import { EDITOR_COMMANDS, type EditorCommand } from './editor-commands.js';

describe('context menu model (FR-EDT-013)', () => {
  it('FR-EDT-013: the point decides the menu: an element, else the screen it is in, else the canvas', () => {
    const area = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(menuTarget('ElementElement01' as never, { x: -50, y: -50 }, area)).toBe('element');
    expect(menuTarget(undefined, { x: 10, y: 10 }, area)).toBe('screen');
    expect(menuTarget(undefined, { x: 1920, y: 1080 }, area)).toBe('screen');
    for (const outside of [
      { x: -1, y: 10 },
      { x: 10, y: -1 },
      { x: 1921, y: 10 },
      { x: 10, y: 1081 },
    ])
      expect(menuTarget(undefined, outside, area)).toBe('canvas');
    expect(menuTarget(undefined, { x: 10, y: 10 }, undefined)).toBe('canvas');
  });

  it('FR-EDT-013: each menu lists editor commands by their titles, and leaves out what is not registered', () => {
    const titles = (target: 'element' | 'screen' | 'canvas', commands: readonly EditorCommand[] = EDITOR_COMMANDS) =>
      menuItems(target, commands).map((i) => i.title);
    expect(titles('element')).toEqual(['Cut', 'Copy', 'Duplicate', 'Delete the selection', 'Select same type', 'Select same style']);
    expect(titles('screen')).toEqual(['Paste', 'Select all', 'Zoom to fit the screen']);
    expect(titles('canvas')).toEqual(['Paste', 'Zoom to fit the screen', 'Zoom to 100 %']);
    expect(menuItems('screen', EDITOR_COMMANDS).map((i) => i.command)).toEqual(['clipboard.paste', 'selection.all', 'camera.fitScreen']);
    expect(
      titles(
        'element',
        EDITOR_COMMANDS.filter((c) => c.id !== 'clipboard.cut' && c.id !== 'selection.sameType'),
      ),
    ).toEqual(['Copy', 'Duplicate', 'Delete the selection', 'Select same style']);
    expect(titles('canvas', [])).toEqual([]);
  });
});
