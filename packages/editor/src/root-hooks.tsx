// The root's hooks that carry its keys, panels and dialogs (split from editor-root.tsx, M7.24).
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';
import type { AssetStore } from './asset-store.js';
import { screenToPage } from './camera.js';
import { createClipboard } from './clipboard.js';
import { PaletteHost } from './command-palette.js';
import type { EditorCommand } from './editor-commands.js';
import { useEditorKeys } from './editor-keys.js';
import { baseKeymap, KeymapDialog, onMac } from './keymap-dialog.js';
import type { KeyOverrides } from './keymap-overrides.js';
import { type EditorLayout, type PanelId, panelShown } from './layout.js';
import { PANEL_NAMES } from './panels.js';
import type { Session } from './session.js';
import { Splitter } from './splitter.js';
import { pasteSystemItem, type SystemItem } from './system-paste.js';
import type { ToolDispatcher } from './tools.js';
import { type SystemClipboardCommands, useSystemClipboard } from './use-system-clipboard.js';
import { readViewMeta, restoreView } from './view-meta.js';

const SPLITTERS: { readonly [P in PanelId]: string } = {
  left: 'Resize the left panel',
  right: 'Resize the inspector',
  bottom: 'Resize the timeline',
};

/** What the root's key handling reads. */
export type RootKeys = {
  readonly store: Store;
  readonly session: Session;
  readonly tools: ToolDispatcher;
  readonly present: ToolDispatcher;
  readonly box: { readonly w: number; readonly h: number };
  readonly area: Box | undefined;
  readonly switchMode: () => void;
  /** The screen shown, as the keys' undo restores it. */
  readonly shown: { readonly current: RecordId | undefined };
  readonly overrides: KeyOverrides;
  /** The dialogs: while one is open the keys are not the editor's. */
  readonly dialogs: DialogState;
  readonly commands: readonly EditorCommand[] | undefined;
  /** The bytes of the document's assets. */
  readonly assets: AssetStore;
};

/** The editor's keys over the root's tools, with its own clipboard (the system clipboard joins it in M7.22); the runner of a command by id. */
export function useRootKeys(i: RootKeys): { readonly run: (command: string, args?: unknown) => boolean; readonly system: SystemClipboardCommands } {
  const { store, session, shown } = i;
  const restore = useCallback(
    (meta: unknown) => {
      const view = readViewMeta(meta);
      if (view !== undefined) restoreView(session, view, shown.current, (id) => store.get(id) !== undefined);
    },
    [session, store, shown],
  );
  const { assets } = i;
  const clipboard = useMemo(() => createClipboard(assets.url), [assets]);
  const run = useEditorKeys({
    store,
    session,
    tools: i.tools,
    present: i.present,
    viewport: i.box,
    area: i.area,
    switchMode: i.switchMode,
    openHelp: i.dialogs.openHelp,
    openPalette: i.dialogs.openPalette,
    commands: i.commands,
    restoreView: restore,
    clipboard,
    assets,
    overrides: i.overrides,
    paused: i.dialogs.help || i.dialogs.palette,
  });
  // what is pasted that is not Fluxion's lands at the centre of the view, selected
  const place = useCallback(
    (item: SystemItem) => {
      const t = i.tools.ctx;
      const centre = screenToPage(session.camera.get(), { x: i.box.w / 2, y: i.box.h / 2 });
      const id = pasteSystemItem({ view: t.view, execute: t.execute, seal: t.seal, screen: t.screen, newId: t.newId, assets }, item, centre);
      if (id !== undefined) session.selection.set([id]);
    },
    [i.tools, i.box.w, i.box.h, session, assets],
  );
  const system = useSystemClipboard({ clipboard, session, run, paused: i.dialogs.help || i.dialogs.palette, place });
  return { run, system };
}

/** The panels and splitters of `layout`: a splitter stays while its panel is collapsed (Enter restores it), controlling nothing then; focus mode hides them all. */
export function usePanels(
  layout: EditorLayout,
  setLayout: (layout: EditorLayout) => void,
): { readonly panel: (p: PanelId, content: ReactNode) => ReactNode; readonly splitter: (p: PanelId) => ReactNode } {
  const id = useId();
  const panel = (p: PanelId, content: ReactNode) => {
    if (!panelShown(layout, p)) return null;
    const size = layout.panels[p].size;
    const Tag = p === 'bottom' ? 'section' : 'aside';
    const style = p === 'bottom' ? { height: size } : { width: size };
    return (
      <Tag id={`${id}-${p}`} aria-label={PANEL_NAMES[p]} className={`fx-chrome-panel fx-chrome-${p}`} style={style} data-panel={p}>
        {content}
      </Tag>
    );
  };
  const splitter = (p: PanelId) =>
    layout.focus ? null : (
      <Splitter panel={p} label={SPLITTERS[p]} controls={layout.panels[p].collapsed ? undefined : `${id}-${p}`} layout={layout} onLayout={setLayout} />
    );
  return { panel, splitter };
}

/** Whether the shortcuts dialog and the command palette are open, and how to open and close them. */
export type DialogState = {
  readonly help: boolean;
  readonly palette: boolean;
  readonly setHelp: (open: boolean) => void;
  readonly setPalette: (open: boolean) => void;
  readonly openHelp: () => void;
  readonly openPalette: () => void;
};

/** The state of the two dialogs. */
export function useDialogs(): DialogState {
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  const openPalette = useCallback(() => setPalette(true), []);
  return { help, palette, setHelp, setPalette, openHelp, openPalette };
}

/** Props of {@link Dialogs}. */
export type DialogsProps = {
  readonly dialogs: DialogState;
  readonly commands: readonly EditorCommand[] | undefined;
  readonly overrides: KeyOverrides;
  readonly onOverrides: (overrides: KeyOverrides) => void;
  readonly tools: ToolDispatcher;
  readonly run: (command: string, args?: unknown) => boolean;
};

/** The command palette and the keyboard shortcuts dialog, whichever is open. */
export function Dialogs(props: DialogsProps): ReactNode {
  const { dialogs, commands, overrides, onOverrides, tools, run } = props;
  const list = tools.list();
  const base = useMemo(() => baseKeymap(list), [list]);
  const mac = onMac();
  return (
    <>
      {dialogs.palette ? (
        <PaletteHost commands={commands} base={base} overrides={overrides} tools={list} mac={mac} run={run} onClose={() => dialogs.setPalette(false)} />
      ) : null}
      {dialogs.help ? <KeymapDialog tools={list} overrides={overrides} onOverrides={onOverrides} onClose={() => dialogs.setHelp(false)} /> : null}
    </>
  );
}
