// The toolbar's Undo and Redo (FR-EDT-012, M7.24): their titles and `aria-keyshortcuts` name the keys the
// commands have now, after the user's rebindings (M7.7 review F1).
import type { Store } from '@fluxion/core';
import type { ReactNode } from 'react';
import type { KeyBinding } from './keymap.js';
import type { KeyOverrides } from './keymap-overrides.js';
import { ariaShortcuts, shortcutsOf } from './palette-model.js';

/** Props of {@link HistoryButtons}. */
export type HistoryButtonsProps = {
  /** The document store, whose history says what can be undone. */
  readonly store: Store;
  /** The keymap before rebindings. */
  readonly base: readonly KeyBinding[];
  /** The user's rebindings. */
  readonly overrides: KeyOverrides;
  /** Whether the page runs on a Mac. */
  readonly mac: boolean;
  /** Run an editor command by id. */
  readonly run: (command: string) => boolean;
};

/** One button for the history command `command`. */
function HistoryButton(props: HistoryButtonsProps & { readonly command: string; readonly label: string; readonly enabled: boolean }): ReactNode {
  const { base, overrides, mac, run, command, label, enabled } = props;
  const keys = shortcutsOf(base, overrides, { command }, mac);
  return (
    <button
      type="button"
      className="fx-chrome-button"
      title={keys.length === 0 ? label : `${label} (${keys.join(', ')})`}
      aria-keyshortcuts={ariaShortcuts(base, overrides, { command }, mac)}
      disabled={!enabled}
      onClick={() => run(command)}
    >
      {label}
    </button>
  );
}

/** The Undo and Redo buttons. */
export function HistoryButtons(props: HistoryButtonsProps): ReactNode {
  const { history } = props.store;
  return (
    <>
      <HistoryButton {...props} command="history.undo" label="Undo" enabled={history.canUndo()} />
      <HistoryButton {...props} command="history.redo" label="Redo" enabled={history.canRedo()} />
    </>
  );
}
