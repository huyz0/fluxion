// The user's rebindings (FR-EDT-012, M7.5): a record from a binding's id (its command and arguments) to
// the chords that replace every default binding of it, kept in the settings store. Pure: the keymap the
// dispatcher uses is `applyOverrides(defaults, overrides)`, and the rebinding dialog reads and writes the
// overrides through the functions here.
import { type KeyBinding, normalizeChord } from './keymap.js';

/**
 * The settings key the overrides are stored under.
 *
 * @public
 */
export const KEYMAP_KEY = 'editor.keymap';

/**
 * The chords the user gave each binding, by {@link bindingId}; an empty list unbinds it.
 *
 * @public
 */
export type KeyOverrides = { readonly [id: string]: readonly string[] };

/**
 * A binding's id: its command, and its arguments when it has some (`tool.use {"id":"hand"}`).
 *
 * @public
 */
export const bindingId = (b: Pick<KeyBinding, 'command' | 'args'>): string => (b.args === undefined ? b.command : `${b.command} ${JSON.stringify(b.args)}`);

/**
 * The overrides in a stored `value`: entries that are not a list of non-empty strings are dropped, so
 * a damaged or newer file never breaks the keys.
 *
 * @public
 */
export function readOverrides(value: unknown): KeyOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: { [id: string]: readonly string[] } = {};
  for (const [id, keys] of Object.entries(value)) {
    if (Array.isArray(keys) && keys.every((k) => typeof k === 'string' && k !== '')) out[id] = keys.map(normalizeChord);
  }
  return out;
}

/**
 * `base` with the overrides applied: a binding with an override gives up its own chords for the
 * override's; an override of a binding that is gone (a removed tool) is ignored.
 *
 * @public
 */
export function applyOverrides(base: readonly KeyBinding[], overrides: KeyOverrides): readonly KeyBinding[] {
  const kept = base.filter((b) => overrides[bindingId(b)] === undefined);
  const added = Object.entries(overrides).flatMap(([id, keys]) => {
    const proto = base.find((b) => bindingId(b) === id);
    return proto === undefined ? [] : keys.map((key): KeyBinding => ({ ...proto, key }));
  });
  return [...kept, ...added];
}

/**
 * One action with the chords it has now, for the rebinding dialog and the cheat sheet.
 *
 * @public
 */
export type KeyGroup = {
  /** The {@link bindingId}. */
  readonly id: string;
  /** The editor command. */
  readonly command: string;
  /** Its arguments. */
  readonly args?: unknown;
  /** Where it applies (see {@link KeyBinding.when}). */
  readonly when?: string | undefined;
  /** Its chords now, overrides applied. */
  readonly keys: readonly string[];
  /** Whether the user changed it. */
  readonly changed: boolean;
};

/**
 * The actions of `base`, in order, with the chords they have under `overrides`.
 *
 * @public
 */
export function keyGroups(base: readonly KeyBinding[], overrides: KeyOverrides): readonly KeyGroup[] {
  const groups = new Map<string, KeyGroup>();
  for (const b of base) {
    const id = bindingId(b);
    const have = groups.get(id);
    if (have !== undefined) {
      groups.set(id, { ...have, keys: [...have.keys, normalizeChord(b.key)] });
      continue;
    }
    const changed = overrides[id] !== undefined;
    const group = { id, command: b.command, when: b.when, keys: [normalizeChord(b.key)], changed };
    // tzap disable next-line ConditionalExpression: only avoids an explicit `args: undefined` key
    groups.set(id, b.args === undefined ? group : { ...group, args: b.args });
  }
  return [...groups.values()].map((g) => (g.changed ? { ...g, keys: overrides[g.id] ?? g.keys } : g));
}

/** Whether two `when` expressions can hold together. */
const overlap = (a: string | undefined, b: string | undefined): boolean => a === undefined || b === undefined || a === b;

/**
 * The overrides after the action `id` is given the single chord `chord`: any other action that has the
 * chord (where both apply) gives it up, so a chord never runs two actions.
 *
 * @public
 */
export function assignKey(base: readonly KeyBinding[], overrides: KeyOverrides, id: string, chord: string): KeyOverrides {
  const key = normalizeChord(chord);
  const groups = keyGroups(base, overrides);
  const mine = groups.find((g) => g.id === id);
  if (mine === undefined) return overrides;
  const next: { [id: string]: readonly string[] } = { ...overrides, [id]: [key] };
  for (const g of groups) {
    if (g.id !== id && g.keys.includes(key) && overlap(g.when, mine.when)) next[g.id] = g.keys.filter((k) => k !== key);
  }
  return next;
}

/**
 * The overrides without the one for `id`: the action has its default chords again.
 *
 * @public
 */
export function resetKey(overrides: KeyOverrides, id: string): KeyOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== id));
}

/**
 * `chord` as people read it: `mod+shift+z` is `Ctrl+Shift+Z` (`⌘`-style names on a Mac: `Cmd+Shift+Z`).
 *
 * @public
 */
export function formatChord(chord: string, mac = false): string {
  const names: { readonly [part: string]: string } = {
    mod: mac ? 'Cmd' : 'Ctrl',
    alt: mac ? 'Option' : 'Alt',
    shift: 'Shift',
    escape: 'Esc',
    arrowleft: 'Left',
    arrowright: 'Right',
    arrowup: 'Up',
    arrowdown: 'Down',
    space: 'Space',
  };
  const parts = normalizeChord(chord).split('+');
  // a trailing `+` is the plus key
  const key = parts.at(-1) === '' ? '+' : (parts.pop() as string);
  const mods = parts.filter((p) => p !== '');
  // tzap disable next-line ConditionalExpression: capitalising a one-character name is upper-casing it
  return [...mods, key].map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join('+');
}

type TitleArgs = { readonly id?: unknown; readonly dx?: unknown; readonly dy?: unknown };

/** The nudge's title from its arguments, or undefined when they are not a nudge's. */
function nudgeTitle(args: TitleArgs): string | undefined {
  const { dx, dy } = args;
  if (typeof dx !== 'number' || typeof dy !== 'number') return undefined;
  const way = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
  return `Nudge ${way} ${Math.abs(dx || dy)} px`;
}

/**
 * A readable title for the action `g`: its command's title, or what its arguments say (a tool's name,
 * a nudge's direction).
 *
 * @public
 */
export function groupTitle(
  g: Pick<KeyGroup, 'command' | 'args'>,
  titleOf: (command: string) => string | undefined,
  toolTitle: (id: string) => string | undefined,
): string {
  const args = (g.args ?? {}) as TitleArgs;
  if (g.command === 'tool.use' && typeof args.id === 'string') return `${toolTitle(args.id) ?? args.id} tool`;
  return (g.command === 'selection.nudge' ? nudgeTitle(args) : undefined) ?? titleOf(g.command) ?? g.command;
}
