// Content CSS (ADR-0010 as amended by ADR-0015): one string of `fx-`-prefixed rules in
// `@layer fx.content`, injected once in the browser and inlined by SSR, so every mode and every host
// renders with byte-identical CSS. Element views may add their own `css` string (registry order).

/**
 * The base content CSS of every rendered screen.
 *
 * @public
 */
export const CONTENT_CSS: string = `@layer fx.content {
.fx-view { position: relative; overflow: hidden; }
.fx-screen { position: absolute; top: 0; left: 0; overflow: hidden; transform-origin: 0 0; box-sizing: border-box; }
.fx-layer { position: absolute; inset: 0; }
.fx-content { pointer-events: none; }
.fx-screen[data-interactive] .fx-content { pointer-events: auto; }
.fx-el { position: absolute; left: 0; top: 0; box-sizing: border-box; transform-origin: 50% 50%; }
.fx-members { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.fx-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border: 1px dashed #94a3b8; background: rgba(148, 163, 184, 0.12); color: #475569; font: 12px/1.2 system-ui, sans-serif; }
.fx-label { position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box; overflow-wrap: break-word; text-rendering: geometricPrecision; }
.fx-connector-label { position: absolute; transform: translate(-50%, -50%); width: max-content; max-width: 240px; padding: 1px 4px; box-sizing: border-box; background: var(--fx-screen-background, transparent); overflow-wrap: break-word; text-rendering: geometricPrecision; }
.fx-label p, .fx-connector-label p { margin: 0; }
.fx-label h1, .fx-connector-label h1, .fx-label h2, .fx-connector-label h2, .fx-label h3, .fx-connector-label h3, .fx-label h4, .fx-connector-label h4, .fx-label h5, .fx-connector-label h5, .fx-label h6, .fx-connector-label h6 { margin: 0; font-weight: 700; line-height: inherit; }
.fx-label h1, .fx-connector-label h1 { font-size: 2em; }
.fx-label h2, .fx-connector-label h2 { font-size: 1.5em; }
.fx-label h3, .fx-connector-label h3 { font-size: 1.25em; }
.fx-label h4, .fx-connector-label h4 { font-size: 1.1em; }
.fx-label h5, .fx-connector-label h5 { font-size: 1em; }
.fx-label h6, .fx-connector-label h6 { font-size: 0.9em; }
.fx-label ul, .fx-connector-label ul, .fx-label ol, .fx-connector-label ol { margin: 0; padding-left: 1.5em; }
.fx-label ul ul, .fx-connector-label ul ul, .fx-label ol ul, .fx-connector-label ol ul { list-style-type: circle; }
.fx-label li, .fx-connector-label li { margin: 0; }
.fx-el > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: block; }
}`;
