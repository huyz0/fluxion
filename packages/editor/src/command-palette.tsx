// The command palette (FR-EDT-011, M7.24): Ctrl/Cmd+K opens a search over every editor command the
// mode offers, with its shortcut beside it. Type to narrow (fuzzy), Up/Down to move, Enter to run, Esc
// to close. A combobox over a listbox, so a screen reader announces the highlighted command.
import { t } from '@lingui/core/macro';
import { type KeyboardEvent, type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { EDITOR_COMMANDS, type EditorCommand } from './editor-commands.js';
import { EDIT_FLAGS, type KeyBinding } from './keymap.js';
import { formatChord, type KeyOverrides } from './keymap-overrides.js';
import { filterEntries, type PaletteEntry, paletteEntries } from './palette-model.js';
import type { Tool } from './tools.js';

/** Props of {@link CommandPalette}. */
export type CommandPaletteProps = {
  /** What the palette lists. */
  readonly entries: readonly PaletteEntry[];
  /** Whether the page runs on a Mac (the chords read `Cmd`). */
  readonly mac: boolean;
  /** Run the chosen entry (the palette has closed). */
  readonly onPick: (entry: PaletteEntry) => void;
  /** Close it. */
  readonly onClose: () => void;
};

/** The index `at` moved by `step`, wrapping within `count`. */
const wrap = (at: number, step: number, count: number): number => (count === 0 ? 0 : (at + step + count) % count);

/** What a key does in the palette: undefined when it types. */
function paletteKey(key: string, hasActive: boolean): 'close' | 'pick' | 'next' | 'previous' | 'stay' | undefined {
  const keys: { readonly [key: string]: 'close' | 'next' | 'previous' | 'stay' } = {
    Escape: 'close',
    ArrowDown: 'next',
    ArrowUp: 'previous',
    Tab: 'stay',
    F5: 'stay',
  };
  return key === 'Enter' ? (hasActive ? 'pick' : undefined) : keys[key];
}

/** The palette dialog. */
export function CommandPalette(props: CommandPaletteProps): ReactNode {
  const { entries, mac, onPick, onClose } = props;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const shown = useMemo(() => filterEntries(entries, query), [entries, query]);
  const active = shown[Math.min(at, shown.length - 1)];
  const doing = {
    close: onClose,
    pick: () => active !== undefined && onPick(active),
    next: () => setAt(wrap(at, 1, shown.length)),
    previous: () => setAt(wrap(at, -1, shown.length)),
    stay: () => undefined,
  };
  const key = (e: KeyboardEvent<HTMLElement>) => {
    // the canvas's shortcuts and undo do not act behind the palette
    e.stopPropagation();
    const act = paletteKey(e.key, active !== undefined);
    if (act === undefined) return;
    e.preventDefault();
    doing[act]();
  };
  return (
    <div className="fx-chrome-picker fx-chrome-palette" role="dialog" aria-modal="true" aria-label={t`Command palette`} onKeyDown={key}>
      <input
        ref={input}
        // biome-ignore lint/a11y/noAutofocus: a dialog that opens to type in
        autoFocus
        className="fx-chrome-input"
        type="text"
        role="combobox"
        aria-label={t`Search commands`}
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={active === undefined ? undefined : `${id}-${active.id}`}
        aria-autocomplete="list"
        placeholder={t`Type a command`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setAt(0);
        }}
      />
      <div id={`${id}-list`} role="listbox" aria-label={t`Commands`} className="fx-chrome-palette-list">
        {shown.map((entry) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the keys work through the combobox input (aria-activedescendant), as in the ARIA pattern
          <div
            key={entry.id}
            id={`${id}-${entry.id}`}
            role="option"
            tabIndex={-1}
            aria-selected={entry === active}
            className="fx-chrome-palette-item"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(entry)}
          >
            <span>{entry.title}</span>
            <kbd className="fx-chrome-kbd">{entry.keys.map((k) => formatChord(k, mac)).join(', ')}</kbd>
          </div>
        ))}
      </div>
      {/* outside the listbox, whose children are options only (a status line for what the listbox lacks) */}
      {shown.length === 0 ? (
        <div role="status" className="fx-chrome-palette-empty">
          {t`No command matches`}
        </div>
      ) : null}
    </div>
  );
}

/** Props of {@link PaletteHost}. */
export type PaletteHostProps = {
  /** Editor commands besides the built-in ones. */
  readonly commands: readonly EditorCommand[] | undefined;
  /** The keymap before rebindings. */
  readonly base: readonly KeyBinding[];
  /** The user's rebindings. */
  readonly overrides: KeyOverrides;
  /** The edit-mode tools, whose titles the tool entries use. */
  readonly tools: readonly Tool[];
  /** Whether the page runs on a Mac. */
  readonly mac: boolean;
  /** Run an editor command by id. */
  readonly run: (command: string, args?: unknown) => boolean;
  /** Close the palette. */
  readonly onClose: () => void;
};

/** The palette over the editor's commands (built-in and extra) as the edit mode offers them. */
export function PaletteHost(props: PaletteHostProps): ReactNode {
  const { commands, base, overrides, tools, mac, run, onClose } = props;
  const entries = useMemo(
    () =>
      paletteEntries({
        commands: [...EDITOR_COMMANDS, ...(commands ?? [])],
        base,
        overrides,
        flags: EDIT_FLAGS,
        toolTitle: (id) => tools.find((tool) => tool.id === id)?.title,
      }),
    [commands, base, overrides, tools],
  );
  return (
    <CommandPalette
      entries={entries}
      mac={mac}
      onClose={onClose}
      onPick={(entry) => {
        // closed first: a command that opens a dialog of its own (the shortcuts) finds the palette gone
        onClose();
        run(entry.command, entry.args);
      }}
    />
  );
}
