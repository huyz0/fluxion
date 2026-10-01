// The keymap (FR-EDT-012, 04 §3.4): every editor shortcut is a binding `{key, command, args?, when?}`
// from a chord to a registered editor command, so each key has one binding and one place to change it
// (M6 cp1 F6). Tools contribute their one-letter shortcuts as `tool.use` bindings. Pure: the window
// dispatcher (keys.tsx) turns events into chords and runs what they resolve to.
import type { KeyInfo, Tool } from './tools.js';

/**
 * One shortcut: the chord `key` runs `command` with `args` where `when` holds.
 *
 * @public
 */
export type KeyBinding = {
  /**
   * The chord: modifiers `mod` (ctrl, or cmd on a Mac), `alt`, `shift` and one key, joined by `+`, e.g.
   * `mod+shift+z`, `shift+1`, `arrowleft`, `f5`. Letters are lower case; digits are the digit keys
   * whatever shift types on them.
   */
  readonly key: string;
  /** The editor command it runs. */
  readonly command: string;
  /** The command's arguments. */
  readonly args?: unknown;
  /**
   * Where it applies: context flags joined by `&&`, each optionally negated with `!` (`edit`,
   * `present`); always when absent.
   */
  readonly when?: string;
};

/**
 * A key press as the keymap reads it: `KeyInfo` and, when known, the layout-independent `code`.
 *
 * @public
 */
export type KeyPress = KeyInfo & {
  /** `KeyboardEvent.code`: shift + 1 is `Digit1` whatever it types. */
  readonly code?: string;
};

const MODIFIERS = ['mod', 'alt', 'shift'] as const;

/** The key part of a chord: a digit key by its code, a space by name, else the key in lower case. */
function base(k: KeyPress): string {
  // tzap disable next-line Regex,StringLiteral: KeyboardEvent.code names are fixed; none but Digit0-9 holds Digit<n>
  const digit = /^Digit(\d)$/.exec(k.code ?? '');
  if (digit !== null) return digit[1] as string;
  return k.key === ' ' ? 'space' : k.key.toLowerCase();
}

/**
 * The chord of the key press `k`, in the canonical form bindings are compared in.
 *
 * @public
 */
export function chordOf(k: KeyPress): string {
  const held = MODIFIERS.filter((m) => k[m]);
  return [...held, base(k)].join('+');
}

/**
 * The canonical form of the chord `chord` (modifiers in the order mod, alt, shift; lower case), so
 * `Shift+Mod+Z` and `mod+shift+z` are one chord. A lone `+` is the plus key.
 *
 * @public
 */
export function normalizeChord(chord: string): string {
  const parts = chord.toLowerCase().split('+');
  // `mod++`: the empty part before the last is the plus key
  const key = parts.at(-1) === '' ? '+' : (parts.at(-1) as string);
  // the key part is never a modifier's name, so the whole chord can be searched for them
  const mods = new Set(parts);
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

/**
 * The context flags while editing.
 *
 * @public
 */
export const EDIT_FLAGS: ReadonlySet<string> = new Set(['edit']);

/**
 * The context flags while presenting in place.
 *
 * @public
 */
export const PRESENT_FLAGS: ReadonlySet<string> = new Set(['present']);

/**
 * Whether the `when` expression `when` holds for the true context flags `flags`.
 *
 * @public
 */
export function whenHolds(when: string | undefined, flags: ReadonlySet<string>): boolean {
  if (when === undefined) return true;
  return when.split('&&').every((term) => {
    const t = term.trim();
    return t.startsWith('!') ? !flags.has(t.slice(1).trim()) : flags.has(t);
  });
}

/**
 * The binding the key press `k` resolves to among `bindings` where `flags` hold; a later binding wins
 * over an earlier one for the same chord (user overrides come last).
 *
 * @public
 */
export function resolveKey(bindings: readonly KeyBinding[], k: KeyPress, flags: ReadonlySet<string>): KeyBinding | undefined {
  const chord = chordOf(k);
  return bindings.findLast((b) => normalizeChord(b.key) === chord && whenHolds(b.when, flags));
}

/** The nudge bindings: each arrow 1 px, with shift 10 px. */
const ARROWS: readonly (readonly [string, number, number])[] = [
  ['arrowleft', -1, 0],
  ['arrowright', 1, 0],
  ['arrowup', 0, -1],
  ['arrowdown', 0, 1],
];
const nudges = ARROWS.flatMap(([key, dx, dy]): KeyBinding[] => [
  { key, command: 'selection.nudge', args: { dx, dy }, when: 'edit' },
  { key: `shift+${key}`, command: 'selection.nudge', args: { dx: dx * 10, dy: dy * 10 }, when: 'edit' },
]);

/**
 * The editor's default bindings (the tools' own come from {@link toolBindings}): undo and redo, the
 * zoom steps and fits, Esc, the nudges, select all, delete, and presenting.
 *
 * @public
 */
export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { key: 'mod+z', command: 'history.undo', when: 'edit' },
  { key: 'mod+shift+z', command: 'history.redo', when: 'edit' },
  { key: 'mod+y', command: 'history.redo', when: 'edit' },
  { key: 'mod+shift+y', command: 'history.redo', when: 'edit' },
  { key: 'mod+=', command: 'camera.zoomIn', when: 'edit' },
  { key: 'mod++', command: 'camera.zoomIn', when: 'edit' },
  { key: 'mod+shift++', command: 'camera.zoomIn', when: 'edit' },
  { key: 'mod+-', command: 'camera.zoomOut', when: 'edit' },
  { key: 'mod+0', command: 'camera.zoom100', when: 'edit' },
  { key: 'mod+shift+0', command: 'camera.zoom100', when: 'edit' },
  { key: 'shift+0', command: 'camera.zoom100', when: 'edit' },
  { key: 'shift+1', command: 'camera.fitScreen', when: 'edit' },
  { key: 'shift+2', command: 'camera.fitSelection', when: 'edit' },
  { key: 'escape', command: 'tool.escape', when: 'edit' },
  ...nudges,
  { key: 'mod+a', command: 'selection.all', when: 'edit' },
  { key: 'mod+shift+a', command: 'selection.all', when: 'edit' },
  { key: 'delete', command: 'selection.delete', when: 'edit' },
  { key: 'backspace', command: 'selection.delete', when: 'edit' },
  { key: 'f5', command: 'mode.toggle' },
  { key: 'shift+f5', command: 'mode.toggle' },
  { key: 'escape', command: 'mode.toggle', when: 'present' },
];

/**
 * A `tool.use` binding for each tool's shortcut, with and without shift (caps and shift both switch,
 * as in M6); a shortcut two tools claim is the first's, in the order given. The command itself refuses
 * a tool of the other mode.
 *
 * @public
 */
export function toolBindings(tools: readonly Tool[]): readonly KeyBinding[] {
  const claimed = new Set<string>();
  return tools.flatMap((t): KeyBinding[] => {
    const key = t.shortcut?.toLowerCase();
    if (key === undefined || claimed.has(key)) return [];
    claimed.add(key);
    return [
      { key, command: 'tool.use', args: { id: t.id } },
      { key: `shift+${key}`, command: 'tool.use', args: { id: t.id } },
    ];
  });
}

/**
 * The chords of `bindings` bound more than once where the same `flags` hold: a keymap without
 * conflicts has none.
 *
 * @public
 */
export function keymapConflicts(bindings: readonly KeyBinding[], flags: ReadonlySet<string>): readonly string[] {
  const seen = new Map<string, number>();
  for (const b of bindings) {
    if (!whenHolds(b.when, flags)) continue;
    const chord = normalizeChord(b.key);
    seen.set(chord, (seen.get(chord) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([chord]) => chord);
}
