// The edit mode's toolbar (M7.24 split from the root): tools, zoom, undo and redo, the clipboard, presenting and help.

import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { useValue } from '@fluxion/render';
import { t } from '@lingui/core/macro';
import type { ReactNode } from 'react';
import { ZoomControls } from './canvas.js';
import { HistoryButtons } from './history-buttons.js';
import type { KeyBinding } from './keymap.js';
import type { KeyOverrides } from './keymap-overrides.js';
import type { EditorLayout } from './layout.js';
import { ToolButtons, Toolbar } from './panels.js';
import type { ModeSwitch } from './present.js';
import type { Session } from './session.js';
import type { ToolDispatcher } from './tools.js';
import type { SystemClipboardCommands } from './use-system-clipboard.js';

/** Props of {@link EditToolbar}. */
export type EditToolbarProps = {
  readonly layout: EditorLayout;
  readonly onLayout: (layout: EditorLayout) => void;
  readonly store: Store;
  readonly session: Session;
  readonly tools: ToolDispatcher;
  /** The canvas's size. */
  readonly box: { readonly w: number; readonly h: number };
  readonly area: Box | undefined;
  /** The keymap before rebindings, and the user's rebindings (the buttons' key hints). */
  readonly base: readonly KeyBinding[];
  readonly overrides: KeyOverrides;
  readonly mac: boolean;
  /** Run an editor command by id. */
  readonly run: (command: string) => boolean;
  readonly system: SystemClipboardCommands;
  readonly switchMode: ModeSwitch;
  readonly openHelp: () => void;
  /** The host-supplied controls: the theme switcher and the Fonts button (a node: the toolbar knows neither). */
  readonly extras?: ReactNode;
};

/** The toolbar of the edit mode. */
export function EditToolbar(props: EditToolbarProps): ReactNode {
  const { layout, onLayout, store, session, tools, box, area, base, overrides, mac, run, system, switchMode, openHelp, extras } = props;
  const snapping = useValue(session.snap.get);
  const grid = useValue(session.grid.get);
  return (
    <Toolbar layout={layout} onLayout={onLayout}>
      <ToolButtons session={session} tools={tools} />
      <ZoomControls store={store} session={session} box={box} area={area} />
      <HistoryButtons store={store} base={base} overrides={overrides} mac={mac} run={run} />
      <button
        type="button"
        className="fx-chrome-button"
        aria-pressed={snapping}
        title={t`Snap to guides (hold Alt or Ctrl while dragging to skip)`}
        onClick={() => session.snap.set(!snapping)}
      >
        {t`Snapping`}
      </button>
      <button
        type="button"
        className="fx-chrome-button"
        aria-pressed={grid}
        title={t`Snap to a 24-unit grid (needs Snapping on)`}
        onClick={() => session.grid.set(!grid)}
      >
        {t`Grid`}
      </button>
      <button type="button" className="fx-chrome-button" title={t`Copy`} onClick={() => void system.copy()}>
        {t`Copy`}
      </button>
      <button type="button" className="fx-chrome-button" title={t`Paste`} onClick={() => void system.paste()}>
        {t`Paste`}
      </button>
      {extras}
      <button type="button" className="fx-chrome-button" aria-keyshortcuts="F5" title={t`Present (F5)`} onClick={() => switchMode('start')}>
        {t`Present`}
      </button>
      <button type="button" className="fx-chrome-button" aria-keyshortcuts="?" title={t`Keyboard shortcuts (?)`} onClick={openHelp}>
        {t`Keyboard shortcuts`}
      </button>
    </Toolbar>
  );
}
