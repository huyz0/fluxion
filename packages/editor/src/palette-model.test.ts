import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { commandMap, EDITOR_COMMANDS, type EditorCommand } from './editor-commands.js';
import { DEFAULT_KEYMAP, EDIT_FLAGS, PRESENT_FLAGS, toolBindings } from './keymap.js';
import { ariaShortcuts, filterEntries, fuzzyScore, type PaletteEntry, paletteEntries, shortcutsOf } from './palette-model.js';
import { createToolRegistry, type Tool } from './tools.js';

const plugin: EditorCommand = { id: 'plugin.flip', title: 'Flip the selection', run: () => true };
const presentOnly: EditorCommand = { id: 'plugin.laser', title: 'Laser pointer', when: 'present', run: () => true };
const tools = (): readonly Tool[] => {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  return registry.list().map(([, tool]) => tool);
};
const base = () => [...DEFAULT_KEYMAP, ...toolBindings(tools())];
const entries = (flags: ReadonlySet<string>, commands: readonly EditorCommand[], overrides = {}) =>
  paletteEntries({ commands, base: base(), overrides, flags, toolTitle: (id) => tools().find((t) => t.id === id)?.title });

describe('the command palette model (FR-EDT-011, FR-EDT-012)', () => {
  it('FR-EDT-011: the model lists each command, a plugin command included, once per binding it has', () => {
    const registry = [...EDITOR_COMMANDS, plugin];
    const shown = entries(EDIT_FLAGS, registry);
    for (const c of registry) {
      // the command that opens the palette is offered in edit mode only; the others in both
      expect(
        shown.some((e) => e.command === c.id),
        c.id,
      ).toBe(true);
    }
    expect(new Set(shown.map((e) => e.id)).size).toBe(shown.length);
    // a plugin command with no binding is one entry, no arguments, no chords
    expect(shown.find((e) => e.command === 'plugin.flip')).toEqual({ id: 'plugin.flip', command: 'plugin.flip', title: 'Flip the selection', keys: [] });
    // a command with arguments in its bindings is one entry per action, titled by them
    expect(shown.find((e) => e.title === 'Nudge left 1 px')?.args).toEqual({ dx: -1, dy: 0 });
    expect(shown.some((e) => e.command === 'tool.use' && e.title === 'Select tool')).toBe(true);
    // and no bare "Use a tool" that would do nothing
    expect(shown.some((e) => e.command === 'tool.use' && e.args === undefined)).toBe(false);
  });

  it('FR-EDT-011: an action is offered where its when holds, and a command by its own when', () => {
    const registry = [...EDITOR_COMMANDS, plugin, presentOnly];
    const edit = entries(EDIT_FLAGS, registry);
    const present = entries(PRESENT_FLAGS, registry);
    expect(edit.some((e) => e.command === 'history.undo')).toBe(true);
    expect(present.some((e) => e.command === 'history.undo')).toBe(false);
    expect(present.some((e) => e.command === 'palette.open')).toBe(false);
    expect(present.some((e) => e.command === 'mode.toggle')).toBe(true);
    expect(edit.some((e) => e.command === 'plugin.laser')).toBe(false);
    expect(present.some((e) => e.command === 'plugin.laser')).toBe(true);
    expect(commandMap(registry).size).toBe(registry.length);
  });

  it('FR-EDT-012: an entry shows the chords it has now, overrides applied; shortcutsOf and ariaShortcuts read the same', () => {
    expect(entries(EDIT_FLAGS, EDITOR_COMMANDS).find((e) => e.command === 'history.undo')?.keys).toEqual(['mod+z']);
    const rebound = { 'history.undo': ['mod+u', 'alt+z'] };
    expect(entries(EDIT_FLAGS, EDITOR_COMMANDS, rebound).find((e) => e.command === 'history.undo')?.keys).toEqual(['mod+u', 'alt+z']);
    expect(shortcutsOf(base(), {}, { command: 'history.undo' })).toEqual(['Ctrl+Z']);
    expect(shortcutsOf(base(), {}, { command: 'history.undo' }, true)).toEqual(['Cmd+Z']);
    expect(shortcutsOf(base(), rebound, { command: 'history.undo' })).toEqual(['Ctrl+U', 'Alt+Z']);
    expect(shortcutsOf(base(), { 'history.undo': [] }, { command: 'history.undo' })).toEqual([]);
    expect(shortcutsOf(base(), {}, { command: 'no.such' })).toEqual([]);
    expect(ariaShortcuts(base(), {}, { command: 'history.redo' })).toBe('Control+Shift+Z Control+Y Control+Shift+Y');
    expect(ariaShortcuts(base(), {}, { command: 'history.undo' }, true)).toBe('Meta+Z');
    expect(ariaShortcuts(base(), {}, { command: 'camera.zoomIn' })).toBe('Control+= Control++');
    expect(ariaShortcuts(base(), { 'selection.all': ['arrowleft'] }, { command: 'selection.all' })).toBe('ArrowLeft');
    expect(ariaShortcuts(base(), { 'history.undo': [] }, { command: 'history.undo' })).toBeUndefined();
  });

  it('FR-EDT-011: a query matches the letters of a title in order, best first; nothing matches nothing', () => {
    expect(fuzzyScore('', 'Undo')).toBe(0);
    expect(fuzzyScore('xyz', 'Undo')).toBeUndefined();
    expect(fuzzyScore('UND', 'undo')).toBeDefined();
    expect(fuzzyScore('u d', 'undo')).toBe(fuzzyScore('ud', 'undo'));
    // consecutive beats scattered, and a word start beats the middle of a word
    expect((fuzzyScore('un', 'Undo') ?? 0) > (fuzzyScore('un', 'Fun and games') ?? 0)).toBe(true);
    expect((fuzzyScore('s', 'Select all') ?? 0) > (fuzzyScore('s', 'Copies') ?? 0)).toBe(true);
    const all: readonly PaletteEntry[] = [
      { id: 'a', command: 'a', title: 'Paste', keys: [] },
      { id: 'b', command: 'b', title: 'Duplicate', keys: [] },
      { id: 'c', command: 'c', title: 'Copy', keys: [] },
      { id: 'd', command: 'd', title: 'Cut', keys: [] },
    ];
    expect(filterEntries(all, '').map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterEntries(all, 'cu').map((e) => e.id)).toEqual(['d']);
    expect(filterEntries(all, 'cop').map((e) => e.id)).toEqual(['c']);
    expect(filterEntries(all, 'zzz')).toEqual([]);
    expect(filterEntries(all, 'p').map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
