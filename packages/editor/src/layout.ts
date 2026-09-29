// The editor's panel layout (FR-EDT-001, ADR-0029): the left tabs, the right inspector and the bottom
// timeline, each with a size and a collapsed flag, and focus mode, which hides them all. Pure: read
// from and written to a SettingsStore by the shell; a stored value is validated and clamped on read.

/**
 * The panels of the editor shell.
 */
export type PanelId = 'left' | 'right' | 'bottom';

/**
 * One panel's state: its size in px (width, or height for `bottom`) and whether it is collapsed.
 */
export type PanelState = {
  /** Width (left, right) or height (bottom), px. */
  readonly size: number;
  /** Hidden, its size kept for when it opens again. */
  readonly collapsed: boolean;
};

/**
 * The whole layout.
 */
export type EditorLayout = {
  /** The panels. */
  readonly panels: { readonly [P in PanelId]: PanelState };
  /** Focus mode: every panel hidden, the canvas alone under the toolbar. */
  readonly focus: boolean;
};

/**
 * The size limits of each panel, px.
 */
export const PANEL_LIMITS: { readonly [P in PanelId]: { readonly min: number; readonly max: number } } = {
  left: { min: 160, max: 480 },
  right: { min: 200, max: 480 },
  bottom: { min: 80, max: 400 },
};

/**
 * The layout of a first visit: the timeline starts collapsed.
 */
export const DEFAULT_LAYOUT: EditorLayout = {
  panels: {
    left: { size: 240, collapsed: false },
    right: { size: 280, collapsed: false },
    bottom: { size: 160, collapsed: true },
  },
  focus: false,
};

/**
 * The settings key the layout is stored under (ADR-0029).
 *
 * @public
 */
export const LAYOUT_KEY = 'fluxion.editor.layout.v1';

const PANELS: readonly PanelId[] = ['left', 'right', 'bottom'];

const clamp = (panel: PanelId, size: number) => Math.min(Math.max(Math.round(size), PANEL_LIMITS[panel].min), PANEL_LIMITS[panel].max);

const isObject = (v: unknown): v is { readonly [k: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One stored panel read back: a finite size clamped, a boolean flag; anything else, the default. */
function readPanel(panel: PanelId, v: unknown): PanelState {
  const fallback = DEFAULT_LAYOUT.panels[panel];
  if (!isObject(v)) return fallback;
  const size = typeof v['size'] === 'number' && Number.isFinite(v['size']) ? clamp(panel, v['size']) : fallback.size;
  const collapsed = typeof v['collapsed'] === 'boolean' ? v['collapsed'] : fallback.collapsed;
  return { size, collapsed };
}

/**
 * A stored layout read back: every field validated and every size clamped; a missing or broken
 * value gives the defaults.
 */
export function readLayout(value: unknown): EditorLayout {
  if (!isObject(value)) return DEFAULT_LAYOUT;
  const panels = isObject(value['panels']) ? value['panels'] : {};
  return {
    panels: { left: readPanel('left', panels['left']), right: readPanel('right', panels['right']), bottom: readPanel('bottom', panels['bottom']) },
    focus: value['focus'] === true,
  };
}

/**
 * `layout` with `panel` sized to `size` (clamped); a collapsed panel opens.
 */
export function resizePanel(layout: EditorLayout, panel: PanelId, size: number): EditorLayout {
  return { ...layout, panels: { ...layout.panels, [panel]: { size: clamp(panel, size), collapsed: false } } };
}

/**
 * `layout` with `panel` collapsed or opened (the other way round from now); its size is kept.
 */
export function togglePanel(layout: EditorLayout, panel: PanelId): EditorLayout {
  const p = layout.panels[panel];
  return { ...layout, panels: { ...layout.panels, [panel]: { ...p, collapsed: !p.collapsed } } };
}

/**
 * `layout` with focus mode switched.
 */
export function toggleFocus(layout: EditorLayout): EditorLayout {
  return { ...layout, focus: !layout.focus };
}

/**
 * Whether `panel` shows in `layout`: not collapsed, and not in focus mode.
 */
export function panelShown(layout: EditorLayout, panel: PanelId): boolean {
  return !layout.focus && !layout.panels[panel].collapsed;
}

/**
 * The panels, in a fixed order.
 */
export function panelIds(): readonly PanelId[] {
  return PANELS;
}

/** Which way each panel grows: +1 when it grows with the pointer's x (left) or y, -1 against it. */
const GROWTH: { readonly [P in PanelId]: { readonly axis: 'x' | 'y'; readonly sign: 1 | -1 } } = {
  left: { axis: 'x', sign: 1 },
  right: { axis: 'x', sign: -1 },
  bottom: { axis: 'y', sign: -1 },
};

/**
 * The size of `panel` after a splitter drag of (`dx`, `dy`) px from `start`, clamped.
 */
export function dragSize(panel: PanelId, start: number, dx: number, dy: number): number {
  const g = GROWTH[panel];
  return clamp(panel, start + g.sign * (g.axis === 'x' ? dx : dy));
}

/** The arrow keys that grow each panel, and those that shrink it. */
const ARROWS: { readonly [P in PanelId]: readonly [grow: string, shrink: string] } = {
  left: ['ArrowRight', 'ArrowLeft'],
  right: ['ArrowLeft', 'ArrowRight'],
  bottom: ['ArrowUp', 'ArrowDown'],
};

/**
 * A splitter's keyboard step, px.
 */
export const SPLITTER_STEP = 10;
/**
 * A splitter's large keyboard step (shift), px.
 */
export const SPLITTER_LARGE_STEP = 50;

/**
 * `layout` after `key` on the splitter of `panel` (the WAI-ARIA window splitter pattern): the arrows
 * along the splitter's axis resize by 10 px (`large`: 50 px), Home and End go to the minimum and
 * maximum, Enter collapses or restores. Undefined for any other key.
 */
export function splitterKey(layout: EditorLayout, panel: PanelId, key: string, large: boolean): EditorLayout | undefined {
  if (key === 'Enter') return togglePanel(layout, panel);
  const step = large ? SPLITTER_LARGE_STEP : SPLITTER_STEP;
  // a collapsed panel grows from nothing, so its first step opens it at its minimum
  const size = layout.panels[panel].collapsed ? 0 : layout.panels[panel].size;
  const [grow, shrink] = ARROWS[panel];
  if (key === shrink && layout.panels[panel].collapsed) return layout;
  const next = new Map<string, number>([
    [grow, size + step],
    [shrink, size - step],
    ['Home', PANEL_LIMITS[panel].min],
    ['End', PANEL_LIMITS[panel].max],
  ]).get(key);
  return next === undefined ? undefined : resizePanel(layout, panel, next);
}

/**
 * `layout` after the toolbar button of `panel`: a shown panel collapses; a hidden one opens, leaving
 * focus mode if that is what hid it.
 */
export function togglePanelShown(layout: EditorLayout, panel: PanelId): EditorLayout {
  if (panelShown(layout, panel)) return togglePanel(layout, panel);
  const p = layout.panels[panel];
  return { focus: false, panels: { ...layout.panels, [panel]: { ...p, collapsed: false } } };
}
