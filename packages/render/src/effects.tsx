// Shadows and effects as one SVG filter (FR-SHP-004, M5.34): drop shadows below the drawing, inset
// shadows over it clipped to its shape, then each effect in the style's order (a glow lights around what
// is drawn so far, a blur softens it). Colours are the resolved style's (`var(--fx-…)`), set as CSS so
// the screen's variables apply. They act on the shape's drawing (outline, stroke, decorations); its
// text label stays sharp (M5.34 review F4). The filter region is as large as the style needs, no larger (M5.34
// review F3: engines cap filter buffers).
import type { ResolvedEffect, ResolvedShadow } from '@fluxion/theme';
import type { ReactNode } from 'react';

/** A shadow's primitives, its result named `name`. */
function Shadow(props: { readonly s: ResolvedShadow; readonly name: string }): ReactNode {
  const { s, name } = props;
  // an inset shadow is cast by the outside of the shape: its alpha inverted
  const source = s.inset ? `${name}-out` : 'SourceAlpha';
  // a positive spread grows the shadow, a negative one shrinks it (M5.34 review F1)
  const spread = s.spread === 0 ? source : `${name}-spread`;
  return (
    <>
      {s.inset ? (
        <feComponentTransfer in="SourceAlpha" result={`${name}-out`}>
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
      ) : null}
      {s.spread === 0 ? null : <feMorphology in={source} operator={s.spread > 0 ? 'dilate' : 'erode'} radius={Math.abs(s.spread)} result={spread} />}
      <feGaussianBlur in={spread} stdDeviation={s.blur / 2} result={`${name}-blur`} />
      <feOffset in={`${name}-blur`} dx={s.x} dy={s.y} result={`${name}-offset`} />
      <feFlood style={{ floodColor: s.color }} result={`${name}-color`} />
      <feComposite in={`${name}-color`} in2={`${name}-offset`} operator="in" result={s.inset ? `${name}-all` : name} />
      {s.inset ? <feComposite in={`${name}-all`} in2="SourceAlpha" operator="in" result={name} /> : null}
    </>
  );
}

/** Effect `k` applied to the result `from`, its own result named `effect-k`. */
function Effect(props: { readonly e: ResolvedEffect; readonly k: number; readonly from: string }): ReactNode {
  const { e, k, from } = props;
  const name = `effect-${k}`;
  if (e.type === 'blur') return <feGaussianBlur in={from} stdDeviation={e.radius / 2} result={name} />;
  // a glow: what is drawn so far, its alpha blurred and coloured, under it
  return (
    <>
      <feGaussianBlur in={from} stdDeviation={e.radius / 2} result={`${name}-blur`} />
      <feFlood style={{ floodColor: e.color }} result={`${name}-color`} />
      <feComposite in={`${name}-color`} in2={`${name}-blur`} operator="in" result={`${name}-light`} />
      <feMerge result={name}>
        <feMergeNode in={`${name}-light`} />
        <feMergeNode in={from} />
      </feMerge>
    </>
  );
}

/**
 * How far beyond the box the style draws: shadow offsets, blurs (3 standard deviations), spreads and
 * glows, plus `margin` (the stroke's reach).
 */
function reach(shadows: readonly ResolvedShadow[], effects: readonly ResolvedEffect[], margin: number): number {
  const shadow = shadows.reduce((m, s) => Math.max(m, Math.max(Math.abs(s.x), Math.abs(s.y)) + 1.5 * s.blur + Math.max(0, s.spread)), 0);
  const effect = effects.reduce((m, e) => m + 1.5 * e.radius, 0);
  return Math.ceil(shadow + effect + margin) + 1;
}

/**
 * The filter `id` drawing `shadows` and `effects` for a `box` whose stroke reaches `margin` px beyond
 * it, or null when there are none.
 */
export function EffectsFilter(props: {
  readonly id: string;
  readonly shadows: readonly ResolvedShadow[];
  readonly effects: readonly ResolvedEffect[];
  readonly box: { readonly w: number; readonly h: number };
  readonly margin: number;
}): ReactNode {
  const { id, shadows, effects, box } = props;
  if (shadows.length === 0 && effects.length === 0) return null;
  const m = reach(shadows, effects, props.margin);
  const below = shadows.flatMap((s, k) => (s.inset ? [] : [`shadow-${k}`]));
  const over = shadows.flatMap((s, k) => (s.inset ? [`shadow-${k}`] : []));
  return (
    <filter id={id} filterUnits="userSpaceOnUse" x={-m} y={-m} width={box.w + 2 * m} height={box.h + 2 * m}>
      {shadows.map((s, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a style's shadows have no identity but their order
        <Shadow key={k} s={s} name={`shadow-${k}`} />
      ))}
      <feMerge result="effect--1">
        {[...below, 'SourceGraphic', ...over].map((name) => (
          <feMergeNode key={name} in={name} />
        ))}
      </feMerge>
      {effects.map((e, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a style's effects have no identity but their order
        <Effect key={k} e={e} k={k} from={`effect-${k - 1}`} />
      ))}
    </filter>
  );
}
