// The edit-mode root (FR-EDT-001): the chrome (ADR-0029) around the canvas, where the document's first
// screen is drawn by the same <ScreenView> as present mode (FR-EDT-010) through the session camera
// (FR-EDT-002), fitted on open, with the tools (FR-EDT-003) working on it.
import type { ReadView, Registry, Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import type { AssetUrls } from '@fluxion/render';
import { type RenderRegistries, screenArea, useValue } from '@fluxion/render';
import { routeConnector } from '@fluxion/routing';
import { createId, type Random, type RecordId, type ScreenRecord } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { type ReactNode, useCallback, useEffect, useId, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { type AssetStore, createAssetStore } from './asset-store.js';
import { registerBuiltinTools } from './builtin-tools.js';
import { fitBox, screenToPage } from './camera.js';
import { Canvas, ZoomControls } from './canvas.js';
import { CHROME_CSS } from './chrome-css.js';
import { createClipboard } from './clipboard.js';
import { PaletteHost } from './command-palette.js';
import { EditBody } from './edit-body.js';
import { EditToolbar } from './edit-toolbar.js';
import type { EditorCommand } from './editor-commands.js';
import { useEditorKeys } from './editor-keys.js';
import type { FontSources } from './font-picker.js';
import { createHitIndex, type HitIndex } from './hit-test.js';
import { ImagePicker } from './image-picker.js';
import { baseKeymap, KeymapDialog, onMac } from './keymap-dialog.js';
import { KEYMAP_KEY, type KeyOverrides, readOverrides } from './keymap-overrides.js';
import { defaultLayout, type EditorLayout, LAYOUT_KEY, type PanelId, panelShown, readLayout } from './layout.js';
import { Inspector, LeftTabs, PANEL_NAMES, Timeline, ToolButtons, Toolbar } from './panels.js';
import type { Execute } from './pointer.js';
import { PresentInPlace, useModeSwitch, useRevision } from './present.js';
import { readOnly } from './present-mode.js';
import { Dialogs, useDialogs, useEnteredLapse, useRootKeys } from './root-hooks.js';
import { shownScreen } from './screen-switch.js';
import { createSession, DEFAULT_CAMERA, type Session } from './session.js';
import { memorySettings, type SettingsStore } from './settings.js';
import { useSnapSetting } from './snap/use-snap-setting.js';
import { pasteSystemItem, type SystemItem } from './system-paste.js';
import type { ThemeChoice } from './theme-switcher.js';
import { ToolbarExtras } from './toolbar-extras.js';
import { createToolDispatcher, createToolRegistry, type Tool, type ToolCtx, type ToolDispatcher } from './tools.js';
import { type SystemClipboardCommands, useSystemClipboard } from './use-system-clipboard.js';
import { readViewMeta, restoreView, withViewMeta } from './view-meta.js';

/**
 * Props of {@link EditorRoot}.
 *
 * @public
 */
export type EditorRootProps = {
  /** The document store. */
  readonly store: Store;
  /** Where element views, shapes and markers are looked up. */
  readonly registries: RenderRegistries;
  /** Where the panel layout persists (default: in memory, for this root only). */
  readonly settings?: SettingsStore;
  /** The document's session: selection, camera, tool, hover (default: a new one for this root). */
  readonly session?: Session;
  /** Runs a command: `Core.execute`, the only write path. */
  readonly execute: Execute;
  /** The tools (default: the built-in ones). */
  readonly tools?: Registry<string, Tool>;
  /** Where fresh record ids come from (default: the browser's crypto). */
  readonly random?: Random;
  /** The bytes of the document's assets (default: an in-memory store for this root, which pasted images fill). */
  readonly assets?: AssetStore;
  /** Editor commands besides the built-in ones, e.g. a plugin's: bindable in the keymap and listed by the command palette. */
  readonly commands?: readonly EditorCommand[];
  /** The themes the theme switcher offers (the host's packs' themes); no switcher when empty or absent. */
  readonly themes?: readonly ThemeChoice[];
  /** Where the font picker gets fonts from (the host's bundled, Google and uploaded fonts); no Fonts button without it. */
  readonly fonts?: FontSources;
};

/** Randomness from the browser's crypto. */
const cryptoRandom: Random = { next: () => (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32 };

/** The tools of `props` dispatched over the session, hit-testing the screen `screenId` by geometry. */
function useTools(
  props: EditorRootProps,
  session: Session,
  screenId: RecordId | undefined,
): { readonly tools: ToolDispatcher; readonly present: ToolDispatcher } {
  const { store, registries, execute } = props;
  const random = props.random ?? cryptoRandom;
  const registry = useMemo(() => {
    if (props.tools !== undefined) return props.tools;
    const builtins = createToolRegistry();
    registerBuiltinTools(builtins);
    return builtins;
  }, [props.tools]);
  // the index follows the store until the root unmounts or its inputs change
  const hits = useRef<HitIndex | undefined>(undefined);
  useEffect(() => {
    const index = createHitIndex(store, { registries, theme: LIGHT_THEME });
    hits.current = index;
    return () => index.dispose();
  }, [store, registries]);
  return useMemo(() => {
    const ctx: ToolCtx = {
      session,
      hitTest: (p) => {
        const hit = screenId === undefined ? undefined : hits.current?.hitTest(screenId, p, session.camera.get().z);
        // a click on a group's member selects the group (inside an entered group, the member's own outermost group)
        return hit === undefined ? undefined : hits.current?.selectableOf(hit, session.entered.get());
      },
      view: store,
      screen: screenId,
      shapeDefs: registries.shapeDefs,
      route: (id) => routeConnector(store, registries, id),
      newId: () => createId(random),
      elementsIn: (box, mode) => (screenId === undefined ? [] : (hits.current?.within(screenId, box, mode) ?? [])),
      allElements: () => (screenId === undefined ? [] : (hits.current?.all(screenId) ?? [])),
      execute,
      seal: () => store.history.seal(),
    };
    // while presenting, the same tools' context with every write refused (FR-PRS-004)
    return { tools: createToolDispatcher(registry, ctx), present: createToolDispatcher(registry, { ...ctx, execute: readOnly }, 'present') };
  }, [registry, session, screenId, execute, store, random, registries]);
}

/** Chrome CSS injected once per document (ADR-0029, like the content CSS of ADR-0015). */
function useChromeCss(): void {
  useInsertionEffect(() => {
    if (document.querySelector('style[data-fx-chrome]')) return;
    const style = document.createElement('style');
    style.dataset['fxChrome'] = '';
    style.textContent = CHROME_CSS;
    document.head.append(style);
  }, []);
}

/** The layout, read from `settings` once and written back on every change. */
function useLayout(settings: SettingsStore): readonly [EditorLayout, (layout: EditorLayout) => void] {
  // a first visit on a phone starts with the side panels collapsed
  const [layout, setLayout] = useState(() => readLayout(settings.get(LAYOUT_KEY), defaultLayout(window.innerWidth)));
  useEffect(() => settings.set(LAYOUT_KEY, layout), [settings, layout]);
  return [layout, setLayout];
}

/** The user's rebindings, read from `settings` once and written back on every change (FR-EDT-012). */
function useKeyOverrides(settings: SettingsStore): readonly [KeyOverrides, (overrides: KeyOverrides) => void] {
  const [overrides, setOverrides] = useState(() => readOverrides(settings.get(KEYMAP_KEY)));
  const set = useCallback(
    (next: KeyOverrides) => {
      settings.set(KEYMAP_KEY, next);
      setOverrides(next);
    },
    [settings],
  );
  return [overrides, set];
}

/**
 * The shown screen changed without anyone choosing it (the one shown was deleted): the first takes over,
 * session.screen follows it, and as for a choice nothing stays selected and the camera starts afresh to be
 * fitted. A choice (the Screens tab, an undo) has set session.screen and its own view already.
 */
function useScreenFallback(session: Session, screenId: RecordId | undefined): void {
  const last = useRef(screenId);
  useEffect(() => {
    if (last.current === screenId) return;
    last.current = screenId;
    if (session.screen.get() === screenId) return;
    session.screen.set(screenId);
    session.selection.set([]);
    session.camera.set(DEFAULT_CAMERA);
  }, [session, screenId]);
}

/** The area of the screen `id`; undefined when there is none, or it was just deleted. */
function areaOf(view: ReadView, id: RecordId | undefined): Box | undefined {
  const screen = id === undefined ? undefined : view.get(id);
  return screen?.type === 'screen' ? screenArea(screen as ScreenRecord) : undefined;
}

/**
 * The screen the root shows (the one the Screens tab chose, or the first: hidden ones are edited too), the ref the keys read
 * it from, and `execute` with every write carrying the view around it, which undo and redo bring back (M7.7).
 */
function useShownScreen(
  props: EditorRootProps,
  session: Session,
): { readonly screenId: RecordId | undefined; readonly shown: { current: RecordId | undefined }; readonly execute: Execute } {
  const { store } = props;
  const wanted = useValue(session.screen.get);
  const screenId = useValue(useMemo(() => store.query((view) => shownScreen(view, wanted)), [store, wanted]));
  useScreenFallback(session, screenId);
  const shown = useRef(screenId);
  shown.current = screenId;
  const execute = useMemo(() => withViewMeta(props.execute, session, () => shown.current), [props.execute, session]);
  return { screenId, shown, execute };
}

/** A camera never moved (still the default) is fitted to the screen once the canvas has a size. */
function useFitOnOpen(session: Session, area: Box | undefined, box: { readonly w: number; readonly h: number }): void {
  useEffect(() => {
    if (area !== undefined && box.w > 0 && session.camera.get() === DEFAULT_CAMERA) session.camera.set(fitBox(area, box));
  }, [area, box, session]);
}

/** Fresh record ids from `random` (default: the browser's crypto). */
function useNewId(random: Random | undefined): () => RecordId {
  return useMemo(() => () => createId(random ?? cryptoRandom), [random]);
}

/** The present mode of the root: the screen presented in place of the editor. */
function PresentShell(props: {
  readonly store: Store;
  readonly registries: RenderRegistries;
  readonly screenId: RecordId | undefined;
  readonly area: Box | undefined;
  readonly session: Session;
  readonly tools: ToolDispatcher;
  readonly assets: AssetUrls;
  readonly revision: number;
}): ReactNode {
  const { revision, ...rest } = props;
  return (
    <div data-testid="editor-root" data-mode="present" data-revision={revision}>
      <PresentInPlace {...rest} />
    </div>
  );
}

/**
 * The editor for the document in `store`: toolbar, panels and the canvas.
 *
 * @public
 */
export function EditorRoot(props: EditorRootProps): ReactNode {
  const { store, registries } = props;
  useChromeCss();
  const settings = useMemo(() => props.settings ?? memorySettings(), [props.settings]);
  const [layout, setLayout] = useLayout(settings);
  const session = useMemo(() => props.session ?? createSession('local'), [props.session]);
  useSnapSetting(settings, session);
  const { screenId, shown, execute } = useShownScreen(props, session);
  const { tools, present } = useTools({ ...props, execute }, session, screenId);
  const switchMode = useModeSwitch(store, session, tools, present);
  const mode = useValue(session.mode.get);
  const revision = useRevision(store);
  const newId = useNewId(props.random);
  // reactive: a resized screen (an edit, undo, the SDK) is fitted at its new size
  const area = useValue(useMemo(() => store.query((view) => areaOf(view, screenId)), [store, screenId]));
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [overrides, setOverrides] = useKeyOverrides(settings);
  const dialogs = useDialogs();
  const base = useMemo(() => baseKeymap(tools.list()), [tools]);
  const assets = useMemo(() => props.assets ?? createAssetStore(), [props.assets]);
  const { run, system } = useRootKeys({ store, session, tools, present, box, area, switchMode, shown, overrides, assets, dialogs, commands: props.commands });
  useFitOnOpen(session, area, box);
  useEnteredLapse(store, session);
  const shell = { store, registries, screenId, area, session, tools: present, assets: assets.url, revision };
  if (mode === 'present') return <PresentShell {...shell} />;
  return (
    <div className="fx-editor" data-testid="editor-root" data-mode="edit" data-revision={revision} data-focus={layout.focus || undefined}>
      <EditToolbar
        layout={layout}
        onLayout={setLayout}
        store={store}
        session={session}
        tools={tools}
        box={box}
        area={area}
        base={base}
        overrides={overrides}
        mac={onMac()}
        run={run}
        system={system}
        switchMode={switchMode}
        openHelp={dialogs.openHelp}
        extras={<ToolbarExtras store={store} execute={execute} session={session} screenId={screenId} themes={props.themes} fonts={props.fonts} />}
      />
      <EditBody
        store={store}
        registries={registries}
        session={session}
        tools={tools}
        execute={execute}
        assets={assets.url}
        screenId={screenId}
        area={area}
        newId={newId}
        onBox={setBox}
        box={box}
        layout={layout}
        onLayout={setLayout}
        menus={{ run, base, overrides, commands: props.commands, mac: onMac() }}
      />
      <Dialogs dialogs={dialogs} commands={props.commands} overrides={overrides} onOverrides={setOverrides} tools={tools} run={run} />
    </div>
  );
}
