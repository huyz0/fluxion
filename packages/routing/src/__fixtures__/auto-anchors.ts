// Layouts for the auto-anchor tests (FR-ANC-004): boxes after layout and the connectors between them, with a layout in which the
// connectors can be drawn without crossing.
import type { Box } from '@fluxion/geometry';

export type AutoScene = { readonly name: string; readonly boxes: Readonly<Record<string, Box>>; readonly edges: ReadonlyArray<readonly [string, string]> };

const box = (x: number, y: number, w = 100, h = 60): Box => ({ x, y, w, h });

export const AUTO_SCENES: readonly AutoScene[] = [
  {
    name: 'row of three with a skip',
    boxes: { a: box(0, 100), b: box(200, 100), c: box(400, 100) },
    edges: [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'c'],
    ],
  },
  {
    name: 'star',
    boxes: { hub: box(200, 200), n: box(200, 0), e: box(450, 200), s: box(200, 400), w: box(-50, 200) },
    edges: [
      ['hub', 'n'],
      ['hub', 'e'],
      ['hub', 's'],
      ['hub', 'w'],
    ],
  },
  {
    name: 'ring of four',
    boxes: { a: box(0, 0), b: box(300, 0), c: box(300, 200), d: box(0, 200) },
    edges: [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'a'],
    ],
  },
  {
    name: 'two columns',
    boxes: { a1: box(0, 0), a2: box(0, 150), b1: box(300, 0), b2: box(300, 150) },
    edges: [
      ['a1', 'b1'],
      ['a2', 'b2'],
    ],
  },
  {
    name: 'staircase',
    boxes: { a: box(0, 0), b: box(200, 120), c: box(400, 240) },
    edges: [
      ['a', 'b'],
      ['b', 'c'],
    ],
  },
  {
    name: 'fan out',
    boxes: { root: box(0, 150), x: box(300, 0), y: box(300, 150), z: box(300, 300) },
    edges: [
      ['root', 'x'],
      ['root', 'y'],
      ['root', 'z'],
    ],
  },
];
