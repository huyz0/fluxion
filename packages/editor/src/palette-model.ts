// The command palette's model (FR-EDT-011, FR-EDT-012, M7.24): which actions it lists, how a query matches
// them, and the chords an action has under the keymap now. Pure: the dialog (command-palette.tsx) shows it,
// and the toolbar's Undo and Redo read their keys here.
import type { EditorCommand } from './editor-commands.js';
import { type KeyBinding, whenHolds } from './keymap.js';
import { bindingId, formatChord, groupTitle, type KeyGroup, type KeyOverrides, keyGroups } from './keymap-overrides.js';
import { commandTitle } from './titles.js';

/**
 * One line of the palette: an editor command, with the arguments a binding gives it (a tool's name, a nudge's
 * direction), its title and its chords now.
 *
 * @public
 */
export type PaletteEntry = {
  /** Unique: the {@link bindingId} of the command and its arguments. */
  readonly id: string;
  /** The editor command it runs. */
  readonly command: string;
  /** The arguments it runs with. */
  readonly args?: unknown;
  /** What the palette shows. */
  readonly title: string;
  /** Its chords now, overrides applied (normalised, see {@link formatChord}). */
  readonly keys: readonly string[];
};

/**
 * What the palette's entries are built from.
 *
 * @public
 */
export type PaletteSource = {
  /** Every editor command there is. */
  readonly commands: readonly EditorCommand[];
  /** The keymap before the user's rebindings. */
  readonly base: readonly KeyBinding[];
  /** The user's rebindings. */
  readonly overrides: KeyOverrides;
  /** The context flags that hold (`edit`, `present`). */
  readonly flags: ReadonlySet<string>;
  /** A tool's title by id. */
  readonly toolTitle: (id: string) => string | undefined;
};

/**
 * The palette's entries: for each action of the keymap whose `when` holds, one entry; and each command no binding
 * names, with no arguments (so every command is reachable). A command whose own `when` fails is left out.
 *
 * @public
 */
export function paletteEntries(source: PaletteSource): readonly PaletteEntry[] {
  const { commands, base, overrides, flags, toolTitle } = source;
  const byId = new Map(commands.map((c) => [c.id, c]));
  const groups = keyGroups(base, overrides);
  const titleOf = (id: string) => {
    const command = byId.get(id);
    return command === undefined ? undefined : commandTitle(command);
  };
  const shown = (command: string) => whenHolds(byId.get(command)?.when, flags);
  const bound = groups
    .filter((g) => byId.has(g.command) && shown(g.command) && whenHolds(g.when, flags))
    .map(
      (g): PaletteEntry => ({
        id: g.id,
        command: g.command,
        ...(g.args === undefined ? {} : { args: g.args }),
        title: groupTitle(g, titleOf, toolTitle),
        keys: g.keys,
      }),
    );
  const named = new Set(groups.map((g) => g.command));
  const loose = commands
    .filter((c) => !named.has(c.id) && shown(c.id))
    .map((c): PaletteEntry => ({ id: c.id, command: c.id, title: commandTitle(c), keys: [] }));
  return [...bound, ...loose];
}

/**
 * How well `query` matches `text`: its letters in order (case ignored, spaces skipped), better when they are
 * consecutive or begin a word; undefined when they are not all there. An empty query matches everything equally.
 *
 * @public
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const wanted = query.toLowerCase().replace(/\s+/g, '');
  const hay = text.toLowerCase();
  let from = 0;
  let score = 0;
  let last = -2;
  for (const ch of wanted) {
    const at = hay.indexOf(ch, from);
    if (at < 0) return undefined;
    // consecutive letters and word starts count most; an early match counts a little
    score += at === last + 1 ? 5 : 1;
    if (at === 0 || hay[at - 1] === ' ') score += 3;
    last = at;
    from = at + 1;
  }
  return score - (wanted.length === 0 ? 0 : last / 100);
}

/**
 * The entries `query` matches, best first (ties keep the order given).
 *
 * @public
 */
export function filterEntries(entries: readonly PaletteEntry[], query: string): readonly PaletteEntry[] {
  return entries
    .map((entry, k) => ({ entry, k, score: fuzzyScore(query, entry.title) }))
    .filter((m): m is { entry: PaletteEntry; k: number; score: number } => m.score !== undefined)
    .sort((a, b) => b.score - a.score || a.k - b.k)
    .map((m) => m.entry);
}

/**
 * An action of the keymap: a command with the arguments a binding gives it.
 *
 * @public
 */
export type PaletteAction = Pick<KeyBinding, 'command' | 'args'>;

/**
 * The chords the action `action` has under `base` and `overrides`, as people read them
 * (`Ctrl+Z`; `Cmd+Z` on a Mac). Empty when it has none.
 *
 * @public
 */
export function shortcutsOf(base: readonly KeyBinding[], overrides: KeyOverrides, action: PaletteAction, mac = false): readonly string[] {
  const id = bindingId(action);
  const group: KeyGroup | undefined = keyGroups(base, overrides).find((g) => g.id === id);
  return (group?.keys ?? []).map((k) => formatChord(k, mac));
}

const ARIA_KEYS: { readonly [key: string]: string } = {
  mod: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  escape: 'Escape',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  space: ' ',
};

/**
 * The chords of `action` for `aria-keyshortcuts` (`Control+Z`, `Meta+Z` on a Mac), space separated; undefined when it has none.
 *
 * @public
 */
export function ariaShortcuts(base: readonly KeyBinding[], overrides: KeyOverrides, action: PaletteAction, mac = false): string | undefined {
  const id = bindingId(action);
  const keys = keyGroups(base, overrides).find((g) => g.id === id)?.keys ?? [];
  const named = (p: string) => (p === 'mod' && mac ? 'Meta' : (ARIA_KEYS[p] ?? (p.length === 1 ? p.toUpperCase() : p)));
  const one = (chord: string) => {
    // a trailing `+` is the plus key
    const parts = chord.split('+');
    const plus = parts.at(-1) === '';
    return [...parts.filter((p) => p !== '').map(named), ...(plus ? ['+'] : [])].join('+');
  };
  return keys.length === 0 ? undefined : keys.map(one).join(' ');
}
