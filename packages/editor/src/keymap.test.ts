import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import {
  chordOf,
  DEFAULT_KEYMAP,
  EDIT_FLAGS,
  type KeyBinding,
  type KeyPress,
  keymapConflicts,
  normalizeChord,
  PRESENT_FLAGS,
  resolveKey,
  toolBindings,
  whenHolds,
} from './keymap.js';
import { createToolRegistry, type Tool } from './tools.js';

const press = (key: string, o: Partial<KeyPress> = {}): KeyPress => ({ key, shift: false, alt: false, mod: false, ...o });

/** Every tool the editor registers, as the editor root lists them (edit tools and the laser). */
function builtinTools(): readonly Tool[] {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  return registry.list().map(([, t]) => t);
}

describe('keymap (FR-EDT-012)', () => {
  it("FR-EDT-012: every default key has one binding, and M6's canvas keys resolve through the keymap", () => {
    const tools = builtinTools();
    const keymap = [...DEFAULT_KEYMAP, ...toolBindings(tools)];
    expect([keymapConflicts(keymap, EDIT_FLAGS), keymapConflicts(keymap, PRESENT_FLAGS)]).toEqual([[], []]);
    const at = (k: KeyPress, flags = EDIT_FLAGS) => {
      const b = resolveKey(keymap, k, flags);
      return b === undefined ? undefined : [b.command, b.args];
    };
    // the keys M6 hard-wired in canvas.tsx, canvas-input.ts, the tools and present.tsx (M6 cp1 F6)
    const m6: readonly (readonly [KeyPress, string, unknown?])[] = [
      [press('z', { mod: true }), 'history.undo'],
      [press('Z', { mod: true, shift: true }), 'history.redo'],
      [press('y', { mod: true }), 'history.redo'],
      [press('Y', { mod: true, shift: true }), 'history.redo'],
      [press(')', { code: 'Digit0', mod: true, shift: true }), 'camera.zoom100'],
      [press('=', { mod: true }), 'camera.zoomIn'],
      [press('+', { mod: true }), 'camera.zoomIn'],
      [press('+', { mod: true, shift: true }), 'camera.zoomIn'],
      [press('-', { mod: true }), 'camera.zoomOut'],
      [press('0', { code: 'Digit0', mod: true }), 'camera.zoom100'],
      [press(')', { code: 'Digit0', shift: true }), 'camera.zoom100'],
      [press('!', { code: 'Digit1', shift: true }), 'camera.fitScreen'],
      [press('@', { code: 'Digit2', shift: true }), 'camera.fitSelection'],
      [press('Escape'), 'tool.escape'],
      [press('ArrowLeft'), 'selection.nudge', { dx: -1, dy: 0 }],
      [press('ArrowDown', { shift: true }), 'selection.nudge', { dx: 0, dy: 10 }],
      [press('a', { mod: true }), 'selection.all'],
      [press('A', { mod: true, shift: true }), 'selection.all'],
      [press('F5'), 'mode.toggle'],
      [press('F5', { shift: true }), 'mode.toggle'],
    ];
    for (const [k, command, args] of m6) expect(at(k), chordOf(k)).toEqual([command, args]);
    // each tool's shortcut, with shift or caps too
    for (const t of tools.filter((x) => x.shortcut !== undefined && (x.modes ?? ['edit']).includes('edit'))) {
      expect([at(press(t.shortcut as string)), at(press((t.shortcut as string).toUpperCase(), { shift: true }))]).toEqual([
        ['tool.use', { id: t.id }],
        ['tool.use', { id: t.id }],
      ]);
    }
    // presenting: Esc and F5 leave, the laser's key is the laser's, and no edit key applies
    expect([at(press('Escape'), PRESENT_FLAGS), at(press('F5'), PRESENT_FLAGS), at(press('l'), PRESENT_FLAGS)]).toEqual([
      ['mode.toggle', undefined],
      ['mode.toggle', undefined],
      ['tool.use', { id: 'laser' }],
    ]);
    for (const k of [press('z', { mod: true }), press('ArrowLeft'), press('Delete'), press('a', { mod: true })]) expect(at(k, PRESENT_FLAGS)).toBeUndefined();
  });

  it('FR-EDT-012: a chord is written one way: modifiers ordered, lower case, digits by their key, space by name', () => {
    expect(['Shift+Mod+Z', 'mod+shift+z', 'ALT+mod+x', 'mod++', 'mod+shift++', '+', 'F5'].map(normalizeChord)).toEqual([
      'mod+shift+z',
      'mod+shift+z',
      'mod+alt+x',
      'mod++',
      'mod+shift++',
      '+',
      'f5',
    ]);
    expect([
      chordOf(press('Z', { mod: true, shift: true, alt: true })),
      chordOf(press('!', { code: 'Digit1', shift: true })),
      chordOf(press(' ')),
      chordOf(press('ArrowUp')),
      chordOf(press('1', { code: 'Numpad1' })),
    ]).toEqual(['mod+alt+shift+z', 'shift+1', 'space', 'arrowup', '1']);
  });

  it('FR-EDT-012: `when` flags join with && and negate with !; no `when` always holds', () => {
    const flags = new Set(['edit', 'selection']);
    expect([
      whenHolds(undefined, flags),
      whenHolds('edit', flags),
      whenHolds('present', flags),
      whenHolds('edit && selection', flags),
      whenHolds('edit && !selection', flags),
      whenHolds(' !present ', flags),
      whenHolds('!edit', flags),
      whenHolds('! edit', flags),
    ]).toEqual([true, true, false, true, false, true, false, false]);
  });

  it('FR-EDT-012: a later binding for a chord wins where it applies, and conflicts are reported per context', () => {
    const user: KeyBinding[] = [
      ...DEFAULT_KEYMAP,
      { key: 'Mod+U', command: 'history.undo', when: 'edit' },
      { key: 'mod+z', command: 'x.none', when: 'present' },
    ];
    expect(resolveKey(user, press('u', { mod: true }), EDIT_FLAGS)?.command).toBe('history.undo');
    expect(resolveKey(user, press('z', { mod: true }), EDIT_FLAGS)?.command).toBe('history.undo');
    expect(resolveKey(user, press('z', { mod: true }), PRESENT_FLAGS)?.command).toBe('x.none');
    const twice: KeyBinding[] = [...user, { key: 'mod+shift+z', command: 'x.other' }];
    expect(resolveKey(twice, press('z', { mod: true, shift: true }), EDIT_FLAGS)?.command).toBe('x.other');
    expect([keymapConflicts(twice, EDIT_FLAGS), keymapConflicts(twice, PRESENT_FLAGS)]).toEqual([['mod+shift+z'], []]);
    expect(resolveKey(twice, press('q'), EDIT_FLAGS)).toBeUndefined();
  });

  it('FR-EDT-012: a shortcut two tools claim is the first one`s; a tool without one binds nothing', () => {
    const tool = (id: string, shortcut?: string): Tool => ({ id, title: id, initial: 'a', states: {}, ...(shortcut === undefined ? {} : { shortcut }) });
    expect(toolBindings([tool('one', 'K'), tool('two', 'k'), tool('three')])).toEqual([
      { key: 'k', command: 'tool.use', args: { id: 'one' } },
      { key: 'shift+k', command: 'tool.use', args: { id: 'one' } },
    ]);
  });
});
