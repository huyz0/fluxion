import { CORE_PATH_DEF, CORE_PATH_ID, createCore } from '@fluxion/core';
import type { DocumentFile, PathData, RecordId, ShapeElement } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { RECT, registries } from './__fixtures__/hit-shapes.js';
import { createHitIndex } from './hit-test.js';
import { regionProblems } from './region-problems.js';

/** A square ring: its hole is open under evenodd, filled under nonzero (both squares wind alike). */
const ring = (fillRule: 'nonzero' | 'evenodd'): PathData => ({ d: 'M 0 0 L 10 0 L 10 10 L 0 10 Z M 3 3 L 7 3 L 7 7 L 3 7 Z', w: 10, h: 10, fillRule });

/** A document with one shape of `defId` at (100, 100), 100 × 100, owning `path`. */
function shaped(defId: `${string}:${string}`, path: PathData) {
  const b = documentBuilder({ seed: 41 });
  const screen = b.screen({ size: { w: 1000, h: 1000 } });
  const id = b.rect(screen, { x: 100, y: 100, w: 100, h: 100, defId, style: { stroke: { width: 1 } } });
  const file = b.build();
  const records = { ...file.records, [id]: { ...(file.records[id] as ShapeElement), path } };
  const core = createCore({ ...file, records } as DocumentFile);
  return { core, screen, id };
}

function hitsOf(core: ReturnType<typeof createCore>) {
  const ctx = registries();
  ctx.shapeDefs.register(CORE_PATH_ID, CORE_PATH_DEF, 'core');
  return createHitIndex(core.store, { registries: ctx, theme: LIGHT_THEME });
}

describe('path shapes in the editor (ADR-0053, M19.41)', () => {
  it('FR-SHP-010: a core:path shape is hit on its own outline under its fill rule: an evenodd hole is not inside', () => {
    const { core, screen, id } = shaped(CORE_PATH_ID, ring('evenodd'));
    const hits = hitsOf(core);
    expect(hits.hitTest(screen, { x: 110, y: 110 }, 1)).toBe(id);
    expect(hits.hitTest(screen, { x: 150, y: 150 }, 1)).toBeUndefined();
    // the hole's edge is stroked, so it is hit there
    expect(hits.hitTest(screen, { x: 130, y: 150 }, 1)).toBe(id);
    hits.dispose();
  });

  it('FR-SHP-010: under nonzero the same ring fills its hole', () => {
    const { core, screen, id } = shaped(CORE_PATH_ID, ring('nonzero'));
    const hits = hitsOf(core);
    expect(hits.hitTest(screen, { x: 150, y: 150 }, 1)).toBe(id);
    hits.dispose();
  });

  it('FR-SHP-010: a path on another definition is ignored: hit as its own outline, and reported with a fix that removes it (ADR-0054)', () => {
    const { core, screen, id } = shaped(RECT.id, ring('evenodd'));
    const hits = hitsOf(core);
    expect(hits.hitTest(screen, { x: 150, y: 150 }, 1)).toBe(id);
    hits.dispose();
    const defs = registries().shapeDefs;
    const problems = regionProblems(core.store.toDocument(), defs);
    expect(problems.map((p) => [p.id, p.severity])).toEqual([[`FLX_PATH_IGNORED|${id}`, 'warning']]);
    const fix = problems[0]?.fix;
    expect(core.execute(fix?.command ?? '', fix?.args).ok).toBe(true);
    expect((core.store.get(id as RecordId) as ShapeElement).path).toBeUndefined();
    expect(regionProblems(core.store.toDocument(), defs)).toEqual([]);
  });

  it('FR-SHP-010: a core:path shape owning its path is not reported', () => {
    const { core } = shaped(CORE_PATH_ID, ring('evenodd'));
    expect(regionProblems(core.store.toDocument(), registries().shapeDefs)).toEqual([]);
  });
});

describe('a path shape of separate islands (M19.41 r1 F1)', () => {
  /** Two islands in a 10 × 10 box: a tall bar on the left (the outline, largest) and a small square at the top right. */
  const islands: PathData = { d: 'M 0 0 L 4 0 L 4 10 L 0 10 Z M 6 0 L 10 0 L 10 4 L 6 4 Z', w: 10, h: 10 };

  it('FR-SHP-010: the smaller island is hit and its box is in the bounds, not only the largest subpath', () => {
    const { core, screen, id } = shaped(CORE_PATH_ID, islands);
    const hits = hitsOf(core);
    expect(hits.hitTest(screen, { x: 180, y: 110 }, 1)).toBe(id);
    expect(hits.hitTest(screen, { x: 120, y: 150 }, 1)).toBe(id);
    // between the islands, and below the small one, nothing is drawn
    expect(hits.hitTest(screen, { x: 150, y: 120 }, 1)).toBeUndefined();
    expect(hits.hitTest(screen, { x: 180, y: 170 }, 1)).toBeUndefined();
    hits.dispose();
  });

  it('FR-SHP-010: a marquee around the smaller island alone, or inside it, touches the shape; one in the gap does not', () => {
    const { core, screen, id } = shaped(CORE_PATH_ID, islands);
    const hits = hitsOf(core);
    expect(hits.within(screen, { x: 155, y: 95, w: 50, h: 50 }, 'intersect')).toEqual([id]);
    expect(hits.within(screen, { x: 175, y: 105, w: 10, h: 10 }, 'intersect')).toEqual([id]);
    expect(hits.within(screen, { x: 145, y: 150, w: 8, h: 40 }, 'intersect')).toEqual([]);
    hits.dispose();
  });
});
