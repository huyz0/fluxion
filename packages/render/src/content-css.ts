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
.fx-el { position: absolute; box-sizing: border-box; transform-origin: 50% 50%; }
.fx-el > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: block; }
}`;
