// The chrome's styles as a stylesheet (FR-PRS-006): the element's shadow root adopts it and a page gets it once in its head, so a page's `::part(controls)` or
// `::part(progress-fill)` rule is not beaten by an inline style. Only what changes with the state (the fill's width) stays inline.
const BAR = 'position:absolute;left:0;right:0;bottom:0;pointer-events:none';
const BUTTON =
  'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;min-width:36px;min-height:36px;cursor:pointer';
const SHADE = 'color:var(--fx-player-chrome-color,#fff);background:var(--fx-player-chrome-background,rgba(0,0,0,.6))';

/** The chrome's stylesheet. */
export const CHROME_CSS: string = [
  `[part~="progress"]{${BAR};height:3px;background:var(--fx-player-progress-track,rgba(255,255,255,.25))}`,
  '[part~="progress-fill"]{height:100%;background:var(--fx-player-progress-fill,#4c8dff)}',
  `[part~="controls"]{${BAR};bottom:3px;display:flex;align-items:center;gap:8px;padding:8px 12px;${SHADE};transition:opacity .2s;pointer-events:auto}`,
  '[part~="controls"][data-visible="false"]{opacity:0;visibility:hidden;pointer-events:none}',
  `[part~="controls"] button{${BUTTON}}`,
  '[part~="controls"] [part~="fullscreen"]{margin-left:auto}',
  `[part~="counter"]{position:absolute;right:12px;top:8px;padding:2px 8px;border-radius:4px;font-variant-numeric:tabular-nums;pointer-events:none;${SHADE}}`,
].join('\n');
