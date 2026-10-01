import { describe, expect, it } from 'vitest';
import { chordOf, DEFAULT_KEYMAP, EDIT_FLAGS, type KeyBinding, type KeyPress, keymapConflicts, resolveKey } from './keymap.js';
import {
  applyOverrides,
  assignKey,
  bindingId,
  formatChord,
  groupTitle,
  KEYMAP_KEY,
  type KeyOverrides,
  keyGroups,
  readOverrides,
  resetKey,
} from './keymap-overrides.js';

const press = (key: string, o: Partial<KeyPress> = {}): KeyPress => ({ key, shift: false, alt: false, mod: false, ...o });
const base: readonly KeyBinding[] = [
  ...DEFAULT_KEYMAP,
  { key: 'v', command: 'tool.use', args: { id: 'select' } },
  { key: 'h', command: 'tool.use', args: { id: 'hand' } },
];
const at = (keymap: readonly KeyBinding[], k: KeyPress) => resolveKey(keymap, k, EDIT_FLAGS)?.command;

describe('keymap overrides (FR-EDT-012)', () => {
  it('FR-EDT-012: a rebinding replaces every default chord of the action, and the old chord does nothing', () => {
    const user = assignKey(base, {}, 'history.undo', 'mod+u');
    expect(user).toEqual({ 'history.undo': ['mod+u'] });
    const keymap = applyOverrides(base, user);
    expect([at(keymap, press('u', { mod: true })), at(keymap, press('z', { mod: true }))]).toEqual(['history.undo', undefined]);
    // redo had three chords: all are replaced by the one
    const redo = applyOverrides(base, assignKey(base, {}, 'history.redo', 'mod+r'));
    expect([at(redo, press('r', { mod: true })), at(redo, press('y', { mod: true })), at(redo, press('Z', { mod: true, shift: true }))]).toEqual([
      'history.redo',
      undefined,
      undefined,
    ]);
    // an action keeps its `when`
    expect(applyOverrides(base, user).find((b) => b.key === 'mod+u')?.when).toBe('edit');
  });

  it('FR-EDT-012: a chord never runs two actions: the other gives it up', () => {
    const user = assignKey(base, {}, 'history.undo', 'mod+y');
    expect(user).toEqual({ 'history.undo': ['mod+y'], 'history.redo': ['mod+shift+z', 'mod+shift+y'] });
    const keymap = applyOverrides(base, user);
    expect(keymapConflicts(keymap, EDIT_FLAGS)).toEqual([]);
    expect([at(keymap, press('y', { mod: true })), at(keymap, press('Z', { mod: true, shift: true }))]).toEqual(['history.undo', 'history.redo']);
    // Present has no `when` of its own, so Esc given to it leaves Cancel (they would run together)
    const present = assignKey(base, {}, 'mode.toggle', 'escape');
    expect(present['tool.escape']).toEqual([]);
    expect(assignKey(base, {}, 'no.such.action', 'x')).toEqual({});
  });

  it('FR-EDT-012: tool shortcuts rebind by tool, and an unbound tool has no chord', () => {
    const hand = bindingId({ command: 'tool.use', args: { id: 'hand' } });
    expect(hand).toBe('tool.use {"id":"hand"}');
    const keymap = applyOverrides(base, assignKey(base, {}, hand, 'g'));
    expect([at(keymap, press('g')), at(keymap, press('h'))]).toEqual(['tool.use', undefined]);
    const none = applyOverrides(base, { [hand]: [] });
    expect(at(none, press('h'))).toBeUndefined();
    expect(keyGroups(base, { [hand]: [] }).find((g) => g.id === hand)).toMatchObject({ keys: [], changed: true });
    // an override of a tool that is gone is ignored
    expect(applyOverrides(base, { 'tool.use {"id":"gone"}': ['q'] })).toEqual(base);
  });

  it('FR-EDT-012: the settings key is part of the contract; a chord is taken only from an action that applies together with the new one', () => {
    expect(KEYMAP_KEY).toBe('editor.keymap');
    const keymap: KeyBinding[] = [
      { key: 'a', command: 'in.edit', when: 'edit' },
      { key: 'a', command: 'in.present', when: 'present' },
      { key: 'a', command: 'in.both' },
      { key: 'b', command: 'other.edit', when: 'edit' },
      { key: 'c', command: 'other.both' },
    ];
    // an edit action takes `a` from the edit one and the one that applies everywhere, not from the present one
    expect(assignKey(keymap, {}, 'other.edit', 'a')).toEqual({ 'other.edit': ['a'], 'in.edit': [], 'in.both': [] });
    expect(assignKey(keymap, {}, 'other.both', 'a')).toEqual({ 'other.both': ['a'], 'in.edit': [], 'in.present': [], 'in.both': [] });
    // an action that does not hold the chord is left alone
    expect(assignKey(keymap, {}, 'in.edit', 'c')).toEqual({ 'in.edit': ['c'], 'other.both': [] });
    // giving an action the chord it already has keeps it
    expect(assignKey(keymap, {}, 'in.edit', 'a')).toEqual({ 'in.edit': ['a'], 'in.both': [] });
    // reset removes just the one override
    expect(resetKey({ a: ['x'], b: ['y'], c: [] }, 'b')).toEqual({ a: ['x'], c: [] });
  });

  it('FR-EDT-012: reset gives the defaults back; groups list each action once with its chords', () => {
    const user = assignKey(base, {}, 'history.undo', 'mod+u');
    const back = resetKey(user, 'history.undo');
    expect(applyOverrides(base, back)).toEqual(base);
    const groups = keyGroups(base, user);
    expect(groups.map((g) => g.id).length).toBe(new Set(groups.map((g) => g.id)).size);
    expect(groups.find((g) => g.id === 'history.undo')).toMatchObject({ keys: ['mod+u'], changed: true, when: 'edit' });
    expect(groups.find((g) => g.id === 'history.redo')).toMatchObject({ keys: ['mod+shift+z', 'mod+y', 'mod+shift+y'], changed: false });
    expect(groups.find((g) => g.id === 'selection.nudge {"dx":-1,"dy":0}')).toMatchObject({ keys: ['arrowleft'], args: { dx: -1, dy: 0 } });
  });

  it('FR-EDT-012: stored overrides are read defensively: wrong shapes and empty chords are dropped, chords normalised', () => {
    const stored = { 'history.undo': ['Mod+U'], 'bad one': 'x', 'bad two': [1], 'bad three': [''], none: [] };
    expect(readOverrides(stored)).toEqual({ 'history.undo': ['mod+u'], none: [] });
    expect([readOverrides(undefined), readOverrides(null), readOverrides([]), readOverrides('x'), readOverrides(5)]).toEqual([{}, {}, {}, {}, {}]);
    const hostile: KeyOverrides = readOverrides(JSON.parse('{"__proto__": ["a"], "constructor": ["b"]}'));
    expect(Object.keys(hostile)).toEqual(['constructor']);
  });

  it('FR-EDT-012: chords are shown as people read them, on a Mac with Cmd and Option', () => {
    const chords = [
      'mod+z',
      'mod+shift+z',
      'escape',
      'arrowleft',
      'arrowright',
      'arrowup',
      'shift+arrowdown',
      'f5',
      'mod++',
      'mod+shift++',
      '?',
      'space',
      'mod+alt+k',
      'delete',
    ];
    expect(chords.map((c) => formatChord(c))).toEqual([
      'Ctrl+Z',
      'Ctrl+Shift+Z',
      'Esc',
      'Left',
      'Right',
      'Up',
      'Shift+Down',
      'F5',
      'Ctrl++',
      'Ctrl+Shift++',
      '?',
      'Space',
      'Ctrl+Alt+K',
      'Delete',
    ]);
    expect([formatChord('mod+alt+k', true), formatChord('mod+shift+z', true)]).toEqual(['Cmd+Option+K', 'Cmd+Shift+Z']);
  });

  it('FR-EDT-012: an action is titled by its command, by its tool, or by the way it nudges', () => {
    const title = (c: string) => (c === 'history.undo' ? 'Undo' : undefined);
    const tool = (id: string) => (id === 'hand' ? 'Hand' : undefined);
    const at = (command: string, args?: unknown) => groupTitle({ command, args }, title, tool);
    expect([
      at('history.undo'),
      at('x.unknown'),
      at('tool.use', { id: 'hand' }),
      at('tool.use', { id: 'laser' }),
      at('selection.nudge', { dx: -1, dy: 0 }),
      at('selection.nudge', { dx: 10, dy: 0 }),
      at('selection.nudge', { dx: 0, dy: -10 }),
      at('selection.nudge', { dx: 0, dy: 1 }),
      at('selection.nudge', { dx: 'x', dy: 0 }),
      at('selection.nudge', { dx: 0, dy: 'x' }),
      at('selection.nudge', { dx: 0, dy: 0 }),
      at('tool.use', { id: 5 }),
      at('history.undo', { id: 'hand' }),
      at('history.undo', { dx: 1, dy: 0 }),
    ]).toEqual([
      'Undo',
      'x.unknown',
      'Hand tool',
      'laser tool',
      'Nudge left 1 px',
      'Nudge right 10 px',
      'Nudge up 10 px',
      'Nudge down 1 px',
      'selection.nudge',
      'selection.nudge',
      'Nudge down 0 px',
      'tool.use',
      'Undo',
      'Undo',
    ]);
  });

  it('FR-EDT-012: a symbol typed with shift is the symbol: ? and + are the same chord on any layout', () => {
    expect([
      chordOf(press('?', { shift: true })),
      chordOf(press('?')),
      chordOf(press('+', { mod: true, shift: true })),
      chordOf(press('Z', { shift: true })),
      chordOf(press('!', { shift: true, code: 'Digit1' })),
    ]).toEqual(['?', '?', 'mod++', 'shift+z', 'shift+1']);
    expect(at(DEFAULT_KEYMAP, press('?', { shift: true }))).toBe('help.keys');
  });
});
