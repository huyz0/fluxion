// The keyboard shortcuts dialog (FR-EDT-012, M7.5): the cheat sheet that lists every action with its
// chords, and the rebinding UI: Change waits for the next chord, Reset gives the defaults back. Opened
// by `?` or the toolbar; Esc closes it.

import { t } from '@lingui/core/macro';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { buttonsOf, dialogKey } from './dialog-keys.js';
import { EDITOR_COMMANDS } from './editor-commands.js';
import { pressOf } from './editor-keys.js';
import { chordOf, DEFAULT_KEYMAP, isModifierKey, type KeyBinding, toolBindings } from './keymap.js';
import { assignKey, formatChord, groupTitle, type KeyOverrides, keyGroups, resetKey } from './keymap-overrides.js';
import { commandTitle, toolTitle } from './titles.js';
import type { Tool } from './tools.js';

/** Props of {@link KeymapDialog}. */
export type KeymapDialogProps = {
  /** The edit-mode tools, whose shortcuts are listed. */
  readonly tools: readonly Tool[];
  /** The user's rebindings now. */
  readonly overrides: KeyOverrides;
  /** Called with the new rebindings. */
  readonly onOverrides: (overrides: KeyOverrides) => void;
  /** Close the dialog. */
  readonly onClose: () => void;
};

const titleOfCommand = (id: string): string | undefined => {
  const command = EDITOR_COMMANDS.find((c) => c.id === id);
  return command === undefined ? undefined : commandTitle(command);
};

/** Whether the page runs on a Mac, where the modifier is Cmd. */
export const onMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform);

/** The default keymap and the tools' bindings, the base the rebindings are applied to. */
export const baseKeymap = (tools: readonly Tool[]): readonly KeyBinding[] => [...DEFAULT_KEYMAP, ...toolBindings(tools)];

/** The dialog: a row per action, with its chords, Change and Reset. */
export function KeymapDialog(props: KeymapDialogProps): ReactNode {
  const { tools, overrides, onOverrides, onClose } = props;
  const [capturing, setCapturing] = useState<string | undefined>(undefined);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dialog.current) buttonsOf(dialog.current)[0]?.focus();
  }, []);
  const base = useMemo(() => baseKeymap(tools), [tools]);
  const groups = useMemo(() => keyGroups(base, overrides), [base, overrides]);
  const toolTitleOf = (id: string) => {
    const tool = tools.find((candidate) => candidate.id === id);
    return tool === undefined ? undefined : toolTitle(tool);
  };
  const mac = onMac();
  /** While a chord is awaited every key is the dialog's: Esc cancels, a modifier alone waits, else it is the new chord. */
  const capture = (e: KeyboardEvent<HTMLElement>, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (isModifierKey(e.key)) return;
    setCapturing(undefined);
    if (e.key !== 'Escape') onOverrides(assignKey(base, overrides, id, chordOf(pressOf(e.nativeEvent))));
  };
  return (
    <div
      ref={dialog}
      className="fx-chrome-picker fx-chrome-keymap"
      role="dialog"
      aria-modal="true"
      aria-label={t`Keyboard shortcuts`}
      onKeyDown={(e) => (capturing === undefined ? dialogKey(e, onClose) : capture(e, capturing))}
    >
      <h2 className="fx-chrome-heading">{t`Keyboard shortcuts`}</h2>
      <table className="fx-chrome-keys">
        <thead>
          <tr>
            <th scope="col" className="fx-chrome-cell">
              {t`Action`}
            </th>
            <th scope="col" className="fx-chrome-cell">
              {t`Shortcut`}
            </th>
            <th scope="col" className="fx-chrome-cell">
              {t`Change`}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const title = groupTitle(g, titleOfCommand, toolTitleOf);
            const waiting = capturing === g.id;
            return (
              <tr key={g.id}>
                <th scope="row" className="fx-chrome-cell">
                  {title}
                </th>
                <td className="fx-chrome-cell">{g.keys.length === 0 ? t`Not set` : g.keys.map((k) => formatChord(k, mac)).join(', ')}</td>
                <td className="fx-chrome-cell">
                  <button type="button" className="fx-chrome-button" aria-label={t`Change ${title}`} onClick={() => setCapturing(g.id)}>
                    {waiting ? t`Press the new shortcut…` : t`Change`}
                  </button>
                  {g.changed ? (
                    <button type="button" className="fx-chrome-button" aria-label={t`Reset ${title}`} onClick={() => onOverrides(resetKey(overrides, g.id))}>
                      {t`Reset`}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="fx-chrome-button" onClick={onClose}>
        {t`Close`}
      </button>
    </div>
  );
}
