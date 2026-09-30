// The container views (02 §3, 04 §1): a group draws nothing of its own, only its members; a frame
// draws its box in its resolved style (its own style over the theme's `defaults.frame`, which the light
// theme sets to a surface-coloured box without a stroke): a colour fill, a stroke with its dash, cap
// and join, and the corner radius, which also rounds the clip of its members unless `clip: false`.
// Members arrive as `children`, already placed (elements.tsx). Styles are inline: the content CSS is a
// contract every host renders byte-identically (ADR-0015).
import type { FrameElement } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import type { ElementViewProps } from './registries.js';
import { concreteLength } from './text-measurer.js';

/**
 * The view of `kind: 'group'` elements: its members only.
 *
 * @public
 */
export function GroupView(props: ElementViewProps): ReactNode {
  return props.children;
}

/** Its members' container: clipped to the frame's box unless `clip` is false. */
const CLIPPED: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden' };

/**
 * The view of `kind: 'frame'` elements: its box, filled and stroked in its style, and its members,
 * clipped to the box unless `clip: false`.
 *
 * @public
 */
export function FrameView(props: ElementViewProps): ReactNode {
  const { theme } = props;
  const element = props.element as FrameElement;
  const { style } = useMemo(
    // tzap disable next-line StringLiteral, ArrayDeclaration: the record path only names where a diagnostic points
    () => resolveStyle(element.style, 'frame', theme, ['records', element.id, 'style']),
    // tzap disable next-line ArrayDeclaration: memo inputs; a single render (every node test) reads none
    [element.style, theme, element.id],
  );
  const { w, h } = element.transform;
  const fill = style.fill.type === 'color' ? style.fill.css : 'none';
  const radius = concreteLength(style.radius, theme);
  const stroke: CSSProperties = {
    stroke: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeLinecap: style.stroke.cap as CSSProperties['strokeLinecap'],
    strokeLinejoin: style.stroke.join as CSSProperties['strokeLinejoin'],
    // tzap disable next-line ConditionalExpression: React leaves an undefined style value out
    ...(style.stroke.dash === undefined ? {} : { strokeDasharray: style.stroke.dash }),
  };
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ opacity: style.opacity }}>
        <rect width={w} height={h} rx={radius} style={{ fill, ...stroke }} />
      </svg>
      {element.clip === false ? props.children : <div style={{ ...CLIPPED, borderRadius: radius }}>{props.children}</div>}
    </>
  );
}
