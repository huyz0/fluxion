// The edit-mode root (FR-EDT-001): the chrome (ADR-0029) around the canvas, where the document's first
// screen is drawn by the same <ScreenView> as present mode (FR-EDT-010), fitted in. The camera (M6.8)
// and tools (M6.11) build on this root.
import type { Store } from '@fluxion/core';
import { useElementBox } from '@fluxion/player';
import { type RenderRegistries, ScreenView, screensInOrder, useValue } from '@fluxion/render';
import { type ReactNode, useEffect, useId, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { CHROME_CSS } from './chrome-css.js';
import { type EditorLayout, LAYOUT_KEY, type PanelId, panelShown, readLayout } from './layout.js';
import { Inspector, LeftTabs, PANEL_NAMES, Timeline, Toolbar } from './panels.js';
import { memorySettings, type SettingsStore } from './settings.js';
import { Splitter } from './splitter.js';

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
};

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

/** The canvas: the first screen, hidden ones included, fitted into it. */
function Canvas(props: Pick<EditorRootProps, 'store' | 'registries'>): ReactNode {
  const { store, registries } = props;
  const ref = useRef<HTMLElement>(null);
  const box = useElementBox(ref);
  const first = useValue(useMemo(() => store.query((view) => screensInOrder(view, true)[0]), [store]));
  return (
    <main ref={ref} aria-label="Canvas" className="fx-chrome-canvas">
      {first === undefined || box.w === 0 ? null : (
        <ScreenView store={store} screenId={first} mode="edit" view={{ kind: 'fit', box }} registries={registries} />
      )}
    </main>
  );
}

const SPLITTERS: { readonly [P in PanelId]: string } = {
  left: 'Resize the left panel',
  right: 'Resize the inspector',
  bottom: 'Resize the timeline',
};

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
      <Toolbar layout={layout} onLayout={setLayout} />
      <div className="fx-chrome-body">
        {panel('left', <LeftTabs />)}
        {splitter('left')}
        <div className="fx-chrome-center">
          <Canvas store={store} registries={registries} />
          {splitter('bottom')}
          {panel('bottom', <Timeline />)}
        </div>
        {splitter('right')}
        {panel('right', <Inspector />)}
      </div>
    </div>
  );
}
