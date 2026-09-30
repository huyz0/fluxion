// The edit-mode root (FR-EDT-001): the chrome (ADR-0029) around the canvas, where the document's first
// screen is drawn by the same <ScreenView> as present mode (FR-EDT-010) through the session camera
// (FR-EDT-002), fitted on open, with the tools (FR-EDT-003) working on it.
import type { ReadView, Registry, Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { type RenderRegistries, screenArea, screensInOrder, useValue } from '@fluxion/render';
import { createId, type Random, type RecordId, type ScreenRecord } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { type ReactNode, useEffect, useId, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { registerBuiltinTools } from './builtin-tools.js';
import { fitBox } from './camera.js';
import { Canvas, ZoomControls } from './canvas.js';
import { CHROME_CSS } from './chrome-css.js';
import { createHitIndex, type HitIndex } from './hit-test.js';
import { type EditorLayout, LAYOUT_KEY, type PanelId, panelShown, readLayout } from './layout.js';
import { Inspector, LeftTabs, PANEL_NAMES, Timeline, ToolButtons, Toolbar } from './panels.js';
import type { Execute } from './pointer.js';
import { createSession, DEFAULT_CAMERA, type Session } from './session.js';
import { memorySettings, type SettingsStore } from './settings.js';
import { Splitter } from './splitter.js';
import { createToolDispatcher, createToolRegistry, type Tool, type ToolDispatcher } from './tools.js';

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
function useTools(props: EditorRootProps, session: Session, screenId: RecordId | undefined): ToolDispatcher {
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
  return useMemo(
    () =>
      createToolDispatcher(registry, {
        session,
        hitTest: (p) => {
          const hit = screenId === undefined ? undefined : hits.current?.hitTest(screenId, p, session.camera.get().z);
          // a click on a group's member selects the group
          return hit === undefined ? undefined : hits.current?.selectableOf(hit);
        },
        view: store,
        newId: () => createId(random),
        elementsIn: (box, mode) => (screenId === undefined ? [] : (hits.current?.within(screenId, box, mode) ?? [])),
        allElements: () => (screenId === undefined ? [] : (hits.current?.all(screenId) ?? [])),
        execute,
        seal: () => store.history.seal(),
      }),
    [registry, session, screenId, execute, store, random],
  );
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
  const [layout, setLayout] = useState(() => readLayout(settings.get(LAYOUT_KEY)));
  useEffect(() => settings.set(LAYOUT_KEY, layout), [settings, layout]);
  return [layout, setLayout];
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
  // hidden screens are edited too
  const screenId = useValue(useMemo(() => store.query((view) => screensInOrder(view, true)[0]), [store]));
  const tools = useTools(props, session, screenId);
  // reactive: a resized screen (an edit, undo, the SDK) is fitted at its new size
  const area = useValue(useMemo(() => store.query((view) => areaOf(view, screenId)), [store, screenId]));
  const [box, setBox] = useState({ w: 0, h: 0 });
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
  return (
    <div className="fx-editor" data-testid="editor-root" data-focus={layout.focus || undefined}>
      <Toolbar layout={layout} onLayout={setLayout}>
        <ToolButtons session={session} tools={tools} />
        <ZoomControls session={session} box={box} area={area} />
      </Toolbar>
      <div className="fx-chrome-body">
        {panel('left', <LeftTabs />)}
        {splitter('left')}
        <div className="fx-chrome-center">
          <Canvas store={store} registries={registries} screenId={screenId} area={area} session={session} tools={tools} onBox={setBox} />
          {splitter('bottom')}
          {panel('bottom', <Timeline />)}
        </div>
        {splitter('right')}
        {panel('right', <Inspector session={session} />)}
      </div>
    </div>
  );
}
