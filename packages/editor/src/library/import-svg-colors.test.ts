// FR-LIB-004: the colors a batch offers for mapping are exactly the renderer's lookup keys (M18.175): a paint attribute as written,
// a style declaration's value trimmed, CSS colors only; at most 64, the rest counted.
import type { ShapeDef } from '@fluxion/core';
import type { SvgArtworkNode } from '@fluxion/schema';
import { expect, it } from 'vitest';
import { MAX_BATCH_COLORS, svgBatchColors } from './import-svg-colors.js';

const node = (attributes: Record<string, string>, children: SvgArtworkNode[] = []): SvgArtworkNode => ({ name: 'g', attributes, children });
const def = (root: SvgArtworkNode) => ({ id: 'x:a', artwork: { viewBox: { x: 0, y: 0, width: 1, height: 1 }, root } }) as unknown as ShapeDef;

it('FR-LIB-004: attributes as written, style values trimmed; none, currentColor, url(…) and other CSS never offered', () => {
  const root = node({ fill: '#F00', stroke: 'none' }, [
    node({ style: 'fill: #00f ;stroke:currentColor; opacity: 0.5', 'stop-color': 'rgb(1 2 3)' }),
    node({ fill: 'url(#g)', stroke: 'CurrentColor', 'stop-color': ' red ', color: 'green' }),
    node({ style: 'stop-color: #F00' }),
  ]);
  expect(svgBatchColors([def(root), { id: 'x:b' } as unknown as ShapeDef])).toEqual({ colors: ['#00f', '#F00', 'rgb(1 2 3)'], colorsOmitted: 0 });
});

it('FR-LIB-004: at most 64 distinct colors are offered in code-unit order, the rest counted', () => {
  const hex = (i: number) => `#${i.toString(16).padStart(6, '0')}`;
  const root = node(
    {},
    Array.from({ length: MAX_BATCH_COLORS + 6 }, (_, i) => node({ fill: hex(i) })),
  );
  const { colors, colorsOmitted } = svgBatchColors([def(root)]);
  expect(colors).toEqual(Array.from({ length: MAX_BATCH_COLORS }, (_, i) => hex(i)));
  expect(colorsOmitted).toBe(6);
});
