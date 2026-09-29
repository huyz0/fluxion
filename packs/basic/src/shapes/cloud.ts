// basic:cloud (FR-SHP-002): eight arcs bulging out from points on an ellipse inside the box. The
// template is written out here, once, from fixed fractions: it stays data (ADR-0016).
import type { ShapeDef } from '@fluxion/sdk';

const BUMPS = 8;
/** Where the bumps meet, as fractions of the box from its centre. */
const RADIUS = 0.34;
/** The bumps' radii, as fractions of the box. */
const BULGE = 0.14;

const fraction = (v: number) => (Math.round(v * 1e4) / 1e4).toString();
const joint = (k: number): string => {
  const a = (2 * Math.PI * k) / BUMPS;
  return `{w/2 + ${fraction(RADIUS * Math.cos(a))} * w} {h/2 + ${fraction(RADIUS * Math.sin(a))} * h}`;
};
const bumps = Array.from({ length: BUMPS }, (_, k) => `A {${BULGE} * w} {${BULGE} * h} 0 0 1 ${joint(k + 1)}`);

/**
 * The cloud.
 *
 * @public
 */
export const cloud: ShapeDef = {
  id: 'basic:cloud',
  outline: { path: `M ${joint(0)} ${bumps.join(' ')} Z` },
  textRegions: [{ name: 'body', x: 0.2, y: 0.25, w: 0.6, h: 0.5 }],
  defaultSize: { w: 180, h: 120 },
  keywords: ['cloud', 'internet', 'network'],
  category: 'basic',
  license: 'MIT',
};
