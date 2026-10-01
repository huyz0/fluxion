// Chrome CSS (ADR-0029): one string in `@layer fx.chrome`, injected once like render's content CSS.
// Every selector's last compound names a chrome class (`fx-editor`, or one starting `fx-chrome-`),
// so no rule matches content. The canvas and its ancestors (CANVAS_PATH) set no inherited property:
// fonts and colours go on the chrome containers beside the canvas, so none reaches the content drawn
// in it (FR-EDT-010). chrome-css.test.ts checks both rules. The canvas keeps at least 320 px (or the
// whole width, if less): on a narrow viewport the panels scroll aside instead of squeezing it away.

/**
 * The chrome classes on the canvas and on each of its ancestors inside the editor, outermost first.
 * No rule on them sets an inherited property.
 */
export const CANVAS_PATH: readonly string[] = ['fx-editor', 'fx-chrome-body', 'fx-chrome-center', 'fx-chrome-canvas'];

/**
 * The editor chrome's CSS.
 */
export const CHROME_CSS: string = `@layer fx.chrome {
.fx-editor { --ui-bg: #f8fafc; --ui-panel: #ffffff; --ui-border: #cbd5e1; --ui-text: #0f172a; --ui-muted: #64748b; --ui-accent: #2563eb; --ui-pressed: #dbeafe; --ui-canvas: #e2e8f0; --ui-focus: #2563eb; --ui-marquee: rgba(37, 99, 235, 0.08); position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--ui-bg); }
.fx-chrome-toolbar { flex: none; display: flex; align-items: center; gap: 4px; height: 40px; overflow-x: auto; padding: 0 8px; box-sizing: border-box; border-bottom: 1px solid var(--ui-border); background: var(--ui-panel); color: var(--ui-text); font: 13px/1.2 system-ui, sans-serif; }
.fx-chrome-toolbar .fx-chrome-spacer { flex: 1; }
.fx-chrome-toolbar .fx-chrome-button { flex: none; white-space: nowrap; font: inherit; color: inherit; padding: 4px 8px; border: 1px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; }
.fx-chrome-toolbar .fx-chrome-button:hover { border-color: var(--ui-border); }
.fx-chrome-toolbar .fx-chrome-button:disabled { opacity: 0.4; cursor: default; }
.fx-chrome-toolbar .fx-chrome-zoom { flex: none; display: flex; align-items: center; gap: 2px; margin: 0; padding: 0; border: 0; min-width: 0; }
.fx-chrome-toolbar .fx-chrome-zoom-value { min-width: 56px; text-align: center; font-variant-numeric: tabular-nums; }
.fx-chrome-toolbar .fx-chrome-button[aria-pressed="true"] { background: var(--ui-pressed); border-color: var(--ui-accent); }
.fx-chrome-body { flex: 1; display: flex; min-height: 0; overflow-x: auto; }
.fx-chrome-center { flex: 1; display: flex; flex-direction: column; min-width: min(100%, 320px); }
.fx-chrome-canvas { flex: 1; position: relative; overflow: hidden; min-height: 0; background: var(--ui-canvas); touch-action: none; }
.fx-chrome-panel { flex: none; overflow: auto; box-sizing: border-box; background: var(--ui-panel); color: var(--ui-text); font: 13px/1.4 system-ui, sans-serif; }
.fx-chrome-panel .fx-chrome-heading { margin: 0; padding: 8px 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ui-muted); }
.fx-chrome-panel .fx-chrome-placeholder { margin: 0; padding: 8px 12px; color: var(--ui-muted); }
.fx-chrome-panel .fx-chrome-tabs { display: flex; border-bottom: 1px solid var(--ui-border); }
.fx-chrome-panel .fx-chrome-tab { flex: 1; font: inherit; color: var(--ui-muted); padding: 8px 4px; border: 0; border-bottom: 2px solid transparent; background: transparent; cursor: pointer; }
.fx-chrome-panel .fx-chrome-tab[aria-selected="true"] { color: var(--ui-text); border-bottom-color: var(--ui-accent); }
.fx-chrome-overlay { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.fx-chrome-overlay .fx-chrome-frame { fill: none; stroke: var(--ui-accent); stroke-width: 1; }
.fx-chrome-overlay .fx-chrome-hover { fill: none; stroke: var(--ui-accent); stroke-width: 2; }
.fx-chrome-overlay .fx-chrome-handle { fill: var(--ui-panel); stroke: var(--ui-accent); stroke-width: 1; }
.fx-chrome-overlay .fx-chrome-param { fill: var(--ui-accent); stroke: var(--ui-panel); stroke-width: 1; }
.fx-chrome-overlay .fx-chrome-route { fill: none; stroke: var(--ui-accent); stroke-width: 1; opacity: 0.5; }
.fx-chrome-overlay .fx-chrome-route-selected { stroke-width: 2; opacity: 0.9; }
.fx-chrome-overlay .fx-chrome-connector-end { fill: var(--ui-panel); stroke: var(--ui-accent); stroke-width: 2; }
.fx-chrome-overlay .fx-chrome-connector-mid { fill: var(--ui-accent); stroke: var(--ui-panel); stroke-width: 1; opacity: 0.7; }
.fx-chrome-overlay .fx-chrome-connector-way { fill: var(--ui-accent); stroke: var(--ui-panel); stroke-width: 2; }
.fx-chrome-overlay .fx-chrome-connector-seg { fill: var(--ui-panel); stroke: var(--ui-accent); stroke-width: 1; opacity: 0.8; }
.fx-chrome-overlay .fx-chrome-marquee { fill: var(--ui-marquee); stroke: var(--ui-accent); stroke-width: 1; }
.fx-chrome-textedit { position: absolute; }
.fx-chrome-textedit-box { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.fx-chrome-textroot { outline: none; width: 100%; white-space: pre-wrap; word-wrap: break-word; }
.fx-chrome-unknown { opacity: 0.6; }
.fx-chrome-fields { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; }
.fx-chrome-group { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.fx-chrome-group .fx-chrome-heading { padding: 4px 0; }
.fx-chrome-field { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; grid-template-columns: 7em 1fr auto; align-items: center; gap: 6px; }
.fx-chrome-field-label { color: var(--ui-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fx-chrome-field-label[data-scrub] { cursor: ew-resize; touch-action: none; user-select: none; }
.fx-chrome-input { min-width: 0; padding: 3px 6px; border: 1px solid var(--ui-border); border-radius: 4px; background: var(--ui-panel); color: var(--ui-text); font: inherit; }
.fx-chrome-slider { min-width: 0; }
.fx-chrome-slider[data-mixed] { opacity: 0.5; }
.fx-chrome-swatch { width: 28px; height: 24px; padding: 0; border: 1px solid var(--ui-border); border-radius: 4px; background: none; }
.fx-chrome-swatch[data-mixed] { opacity: 0.5; }
.fx-chrome-choices { display: flex; gap: 2px; flex-wrap: wrap; }
.fx-chrome-picker { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; gap: 4px; min-width: 240px; padding: 12px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-panel); color: var(--ui-text); font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2); }
.fx-chrome-screens { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.fx-chrome-keymap { min-width: 420px; max-width: 90vw; max-height: 80vh; overflow: auto; }
.fx-chrome-keys { border-collapse: collapse; }
.fx-chrome-keys .fx-chrome-cell { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--ui-border); font-weight: normal; }
.fx-chrome-picker .fx-chrome-button { font: inherit; color: inherit; text-align: left; padding: 6px 8px; border: 1px solid var(--ui-border); border-radius: 4px; background: transparent; cursor: pointer; }
.fx-chrome-overlay .fx-chrome-sketch { fill: none; stroke: var(--ui-accent); stroke-width: 1.5; }
.fx-chrome-overlay .fx-chrome-draft { fill: none; stroke: var(--ui-accent); stroke-width: 1; stroke-dasharray: 4 3; }
.fx-chrome-splitter { flex: none; background: var(--ui-border); touch-action: none; }
.fx-chrome-splitter[aria-orientation="vertical"] { width: 4px; cursor: col-resize; }
.fx-chrome-splitter[aria-orientation="horizontal"] { height: 4px; cursor: row-resize; }
.fx-chrome-splitter:hover, .fx-chrome-splitter.fx-chrome-dragging { background: var(--ui-accent); }
.fx-editor .fx-chrome-button:focus-visible, .fx-editor .fx-chrome-tab:focus-visible, .fx-editor .fx-chrome-splitter:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: -2px; }
@media (prefers-color-scheme: dark) {
.fx-editor { --ui-bg: #0f172a; --ui-panel: #1e293b; --ui-border: #334155; --ui-text: #e2e8f0; --ui-muted: #94a3b8; --ui-accent: #60a5fa; --ui-pressed: #1e3a8a; --ui-canvas: #020617; --ui-focus: #93c5fd; --ui-marquee: rgba(96, 165, 250, 0.12); }
}
}`;
