// FR-EDT-004: a point hit-test among 2 000 elements; the M6 gate's bench leg holds its p99 to
// HIT_TEST_2000_MAX_MS. The document mixes filled, rotated, hollow and thin-stroke shapes, text and
// connectors on one 4000 x 4000 screen; the index is built once, as the editor keeps it, and each
// iteration hit-tests the next point of a fixed sequence.
import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import { type RecordId, seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, test } from 'vitest';
import { createHitIndex } from '../src/hit-test.js';

const RECT: ShapeDef = { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } };
const LINE: ShapeDef = { id: 'basic:line', outline: { path: 'M 0 {h/2} L {w} {h/2}' }, defaultSize: { w: 160, h: 16 } };
const ELEMENTS = 2_000;
const SIDE = 4_000;

function fixture() {
  const b = documentBuilder({ seed: 2000 });
  const screen = b.screen({ size: { w: SIDE, h: SIDE } });
  const random = seededRandom(7);
  const at = () => Math.floor(random.next() * (SIDE - 200));
  const shapes: RecordId[] = [];
  // every tenth element connects two earlier shapes
  for (let i = 0; i < ELEMENTS; i++) {
    const o = { x: at(), y: at(), w: 40 + (i % 5) * 30, h: 30 + (i % 3) * 20 };
    if (i % 10 === 9) b.connect(shapes.at(-1) as RecordId, shapes.at(-5) as RecordId);
    else if (i % 4 === 0) shapes.push(b.rect(screen, { ...o, rot: (i * 17) % 360 }));
    else if (i % 4 === 1) shapes.push(b.rect(screen, { ...o, style: { fill: 'transparent', stroke: { width: 2 } } }));
    else if (i % 4 === 2) shapes.push(b.rect(screen, { ...o, h: 16, defId: 'basic:line' }));
    else shapes.push(b.text(screen, 'label', o));
  }
  const core = createCore(b.build());
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  for (const def of [RECT, LINE]) shapeDefs.register(def.id, def, 'bench');
  const hits = createHitIndex(core.store, { registries: { shapeDefs, routers: createRegistry('routers') }, theme: LIGHT_THEME });
  const points = Array.from({ length: 1_000 }, () => ({ x: random.next() * SIDE, y: random.next() * SIDE }));
  return { core, screen, hits, points };
}

describe('hit-testing (FR-EDT-004)', () => {
  test('FR-EDT-004: hit-test-2000', async ({ bench }) => {
    const { core, screen, hits, points } = fixture();
    const elements = core.store.members('byType', 'element').length;
    if (elements !== ELEMENTS) throw new Error(`the fixture has ${elements} elements, not ${ELEMENTS}`);
    let k = 0;
    await bench('hit-test-2000', { async: false }, () => {
      hits.hitTest(screen, points[k++ % points.length] as { x: number; y: number }, 1);
    }).run({ time: 2_000, warmupTime: 300 });
    hits.dispose();
  });
});
