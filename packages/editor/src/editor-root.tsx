// The edit-mode root (FR-EDT-001): the chrome (ADR-0029) around the canvas, where the document's first
// screen is drawn by the same <ScreenView> as present mode (FR-EDT-010) through the session camera
// (FR-EDT-002), fitted on open, with the tools (FR-EDT-003) working on it.
import type { ReadView, Registry, Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { type RenderRegistries, screenArea, useValue } from '@fluxion/render';
import { routeConnector } from '@fluxion/routing';
import { createId, type Random, type RecordId, type ScreenRecord } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { type ReactNode, useCallback, useEffect, useId, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { registerBuiltinTools } from './builtin-tools.js';
import { fitBox } from './camera.js';
import { Canvas, ZoomControls } from './canvas.js';
import { CHROME_CSS } from './chrome-css.js';
import { createClipboard } from './clipboard.js';
import { useEditorKeys } from './editor-keys.js';
import { createHitIndex, type HitIndex } from './hit-test.js';
import { ImagePicker } from './image-picker.js';
import { KeymapDialog } from './keymap-dialog.js';
import { KEYMAP_KEY, type KeyOverrides, readOverrides } from './keymap-overrides.js';
import { defaultLayout, type EditorLayout, LAYOUT_KEY, type PanelId, panelShown, readLayout } from './layout.js';
import { Inspector, LeftTabs, PANEL_NAMES, Timeline, ToolButtons, Toolbar } from './panels.js';
import type { Execute } from './pointer.js';
import { PresentInPlace, useModeSwitch, useRevision } from './present.js';
import { readOnly } from './present-mode.js';
import { shownScreen } from './screen-switch.js';
import { createSession, DEFAULT_CAMERA, type Session } from './session.js';
import { memorySettings, type SettingsStore } from './settings.js';
import { Splitter } from './splitter.js';
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
        // a click on a group's member selects the group
        return hit === undefined ? undefined : hits.current?.selectableOf(hit);
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

const SPLITTERS: { readonly [P in PanelId]: string } = {
  left: 'Resize the left panel',
  right: 'Resize the inspector',
  bottom: 'Resize the timeline',
};

/** The area of the screen `id`; undefined when there is none, or it was just deleted. */
function areaOf(view: ReadView, id: RecordId | undefined): Box | undefined {
  const screen = id === undefined ? undefined : view.get(id);
  return screen?.type === 'screen' ? screenArea(screen as ScreenRecord) : undefined;
}

/** What the root's key handling reads. */
type RootKeys = {
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
  readonly help: boolean;
  readonly openHelp: () => void;
};

/** The editor's keys over the root's tools, with its own clipboard (the system clipboard joins it in M7.22); the runner of a command by id. */
function useRootKeys(i: RootKeys): { readonly run: (command: string, args?: unknown) => boolean; readonly system: SystemClipboardCommands } {
  const { store, session, shown } = i;
  const restore = useCallback(
    (meta: unknown) => {
      const view = readViewMeta(meta);
      if (view !== undefined) restoreView(session, view, shown.current, (id) => store.get(id) !== undefined);
    },
    [session, store, shown],
  );
  const clipboard = useMemo(() => createClipboard(), []);
  const run = useEditorKeys({
    store,
    session,
    tools: i.tools,
    present: i.present,
    viewport: i.box,
    area: i.area,
    switchMode: i.switchMode,
    openHelp: i.openHelp,
    restoreView: restore,
    clipboard,
    overrides: i.overrides,
    paused: i.help,
  });
  const system = useSystemClipboard({ clipboard, session, run, paused: i.help });
  return { run, system };
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
  // the screen the Screens tab chose, or the first (hidden ones are edited too)
  const wanted = useValue(session.screen.get);
  const screenId = useValue(useMemo(() => store.query((view) => shownScreen(view, wanted)), [store, wanted]));
  useScreenFallback(session, screenId);
  // every write carries the view around it, which undo and redo bring back (M7.7)
  const shown = useRef(screenId);
  shown.current = screenId;
  const execute = useMemo(() => withViewMeta(props.execute, session, () => shown.current), [props.execute, session]);
  const { tools, present } = useTools({ ...props, execute }, session, screenId);
  const switchMode = useModeSwitch(session, tools, present);
  const mode = useValue(session.mode.get);
  const revision = useRevision(store);
  const newId = useMemo(() => {
    const random = props.random ?? cryptoRandom;
    return () => createId(random);
  }, [props.random]);
  // reactive: a resized screen (an edit, undo, the SDK) is fitted at its new size
  const area = useValue(useMemo(() => store.query((view) => areaOf(view, screenId)), [store, screenId]));
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [overrides, setOverrides] = useKeyOverrides(settings);
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  const { run, system } = useRootKeys({ store, session, tools, present, box, area, switchMode, shown, overrides, help, openHelp });
  // a camera never moved (still the default) is fitted to the screen once the canvas has a size
  useEffect(() => {
    if (area !== undefined && box.w > 0 && session.camera.get() === DEFAULT_CAMERA) session.camera.set(fitBox(area, box));
  }, [area, box, session]);
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
  // a splitter stays while its panel is collapsed (Enter restores it), controlling nothing then; focus
  // mode hides them all
  const splitter = (p: PanelId) =>
    layout.focus ? null : (
      <Splitter panel={p} label={SPLITTERS[p]} controls={layout.panels[p].collapsed ? undefined : `${id}-${p}`} layout={layout} onLayout={setLayout} />
    );
  if (mode === 'present')
    return (
      <div data-testid="editor-root" data-mode="present" data-revision={revision}>
        <PresentInPlace store={store} registries={registries} screenId={screenId} area={area} session={session} tools={present} />
      </div>
    );
  return (
    <div className="fx-editor" data-testid="editor-root" data-mode="edit" data-revision={revision} data-focus={layout.focus || undefined}>
      <Toolbar layout={layout} onLayout={setLayout}>
        <ToolButtons session={session} tools={tools} />
        <ZoomControls store={store} session={session} box={box} area={area} />
        <button type="button" className="fx-chrome-button" title="Undo" disabled={!store.history.canUndo()} onClick={() => run('history.undo')}>
          Undo
        </button>
        <button type="button" className="fx-chrome-button" title="Redo" disabled={!store.history.canRedo()} onClick={() => run('history.redo')}>
          Redo
        </button>
        <button type="button" className="fx-chrome-button" title="Copy" onClick={() => void system.copy()}>
          Copy
        </button>
        <button type="button" className="fx-chrome-button" title="Paste" onClick={() => void system.paste()}>
          Paste
        </button>
        <button type="button" className="fx-chrome-button" aria-keyshortcuts="F5" title="Present (F5)" onClick={switchMode}>
          Present
        </button>
        <button type="button" className="fx-chrome-button" aria-keyshortcuts="?" title="Keyboard shortcuts (?)" onClick={openHelp}>
          Keyboard shortcuts
        </button>
      </Toolbar>
      <div className="fx-chrome-body">
        {panel('left', <LeftTabs screens={{ store, session, shown: screenId }} />)}
        {splitter('left')}
        <div className="fx-chrome-center">
          <Canvas store={store} registries={registries} screenId={screenId} area={area} session={session} tools={tools} execute={execute} onBox={setBox} />
          {splitter('bottom')}
          {panel('bottom', <Timeline />)}
        </div>
        <ImagePicker store={store} session={session} execute={execute} screenId={screenId} newId={newId} />
        {splitter('right')}
        {panel('right', <Inspector session={session} fields={{ store, execute, shapeDefs: registries.shapeDefs }} />)}
      </div>
      {help ? <KeymapDialog tools={tools.list()} overrides={overrides} onOverrides={setOverrides} onClose={() => setHelp(false)} /> : null}
    </div>
  );
}
