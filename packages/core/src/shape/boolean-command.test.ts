import type { AnchorRef, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';
import { CORE_PATH_ID } from './path-shape.js';

/** Two overlapping rects (b above a) and an outside shape, with connectors from `other` bound to a at `anchors`. */
function setup(anchors: readonly AnchorRef[] = []) {
  const b = documentBuilder({ seed: 1918 });
  const screen = b.screen({ size: { w: 1000, h: 1000 } });
  const a = b.rect(screen, { x: 100, y: 100, w: 200, h: 100, style: { fill: '#ff0000' } });
  const top = b.rect(screen, { x: 250, y: 100, w: 100, h: 100, label: 'top' });
  const other = b.rect(screen, { x: 600, y: 600 });
  const lines = anchors.map((anchor) => b.connect(other, a, { targetAnchor: anchor }));
  const core = createCore(b.build());
  return { core, screen, a, top, other, lines };
}

/** The union of a (100..300 × 100..200) and top (250..350 × 100..200): one rectangle 250 wide. */
const UNION = { path: { d: 'M 0 0 L 250 0 L 250 100 L 0 100 Z', w: 250, h: 100, fillRule: 'evenodd' as const }, box: { x: 100, y: 100, w: 250, h: 100 } };

const bindingOf = (core: ReturnType<typeof setup>['core'], line: RecordId) =>
  core.store
    .members('byType', 'binding')
    .map((x) => core.store.get(x) as unknown as { connectorId: RecordId; end: string; elementId: RecordId; anchor: AnchorRef })
    .find((x) => x.connectorId === line && x.end === 'target');

describe('the boolean command (ADR-0053, FR-SHP-010)', () => {
  it('FR-SHP-010: the operands become one path shape in their place with the bottom one’s style, in one undo step', () => {
    const { core, a, top, other } = setup();
    const before = core.store.toDocument();
    const r = core.execute('shape.boolean', { ids: [top, a], resultId: 'result', op: 'union', ...UNION });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect(core.store.has(a) || core.store.has(top)).toBe(false);
    const made = core.store.get('result' as RecordId) as unknown as Record<string, unknown>;
    const bottom = before.records[a] as unknown as Record<string, unknown>;
    expect(made).toMatchObject({
      kind: 'shape',
      defId: CORE_PATH_ID,
      path: UNION.path,
      transform: { ...UNION.box, rot: 0 },
      index: bottom['index'],
      style: bottom['style'],
    });
    expect(made['text']).toBeUndefined();
    expect(core.store.has(other)).toBe(true);
    expect(core.store.history.undoDepth).toBe(1);
    core.store.history.undo();
    expect(core.store.toDocument()).toEqual(before);
  });

  it('FR-SHP-010: a connector keeps its place where that place still lies on the result outline, else moves to auto', () => {
    const anchors: AnchorRef[] = [
      { kind: 'named', name: 'n' },
      { kind: 'named', name: 'center' },
      { kind: 'floating' },
      { kind: 'side', side: 'e', t: 0.5 },
      { kind: 'point', x: 0.5, y: 0.5 },
      { kind: 'side', side: 'w', t: 0.5 },
    ];
    const { core, a, top, lines } = setup(anchors);
    expect(core.execute('shape.boolean', { ids: [a, top], resultId: 'result', op: 'union', ...UNION }).ok).toBe(true);
    const after = lines.map((l) => bindingOf(core, l));
    expect(after.map((x) => x?.elementId)).toEqual(lines.map(() => 'result'));
    // a's n (200, 100) is on the outline but the result's n is not there: a point anchor keeps the place; a's e (300, 150) and
    // centre are inside the union; a's w (100, 150) is the result's w
    expect(after.map((x) => x?.anchor)).toEqual([
      { kind: 'point', x: 0.4, y: 0 },
      { kind: 'auto' },
      { kind: 'floating' },
      { kind: 'auto' },
      { kind: 'auto' },
      { kind: 'side', side: 'w', t: 0.5 },
    ]);
  });

  it('FR-SHP-010: refuses fewer than two shapes, a repeat, a non-shape, shapes in different containers, a locked one and a bad path', () => {
    const { core, a, top, screen } = setup();
    const run = (args: Record<string, unknown>) => core.execute('shape.boolean', { ids: [a, top], resultId: 'result', op: 'union', ...UNION, ...args });
    expect(run({ ids: [a] }).ok).toBe(false);
    expect(run({ ids: [a, a] }).ok).toBe(false);
    expect(run({ ids: [a, screen] }).ok).toBe(false);
    expect(run({ path: { d: 'M 0 0 A 1 1 0 0 1 2 2', w: 10, h: 10 } }).ok).toBe(false);
    expect(core.execute('element.group', { ids: [top], groupId: 'g' }).ok).toBe(true);
    expect(run({}).ok).toBe(false);
    core.store.history.undo();
    expect(core.execute('element.update', { id: a, fields: { locks: { delete: true } } }).ok).toBe(true);
    expect(run({}).ok).toBe(false);
    expect(core.store.has(a) && core.store.has(top)).toBe(true);
  });
});
