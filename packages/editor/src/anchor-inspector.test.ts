// FR-ANC-006: the inspector lists a shape's anchors by name; FR-ANC-005: custom anchors are added, moved and removed on a shape instance,
// each one undo step.
import { createCore, type ShapeDef } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { addAnchor, anchorRows, moveAnchor, removeAnchor } from './anchor-inspector.js';

const rect = { id: 'test:rect', outline: { path: 'M 0 0 H {w} V {h} H 0 Z' }, anchors: [{ name: 'port', x: 0, y: 0.5 }] } as unknown as ShapeDef;
const defs = { get: (id: string) => (id === 'test:rect' ? rect : undefined) };

function setup() {
  const b = documentBuilder({ seed: 1625 });
  const screen = b.screen();
  const shape = b.rect(screen, { x: 0, y: 0, w: 100, h: 100, defId: 'test:rect' });
  const text = b.text(screen, 'a caption');
  const core = createCore(b.build());
  const run = (c: { id: string; args: unknown } | undefined) => {
    if (c === undefined) throw new Error('no command');
    expect(core.execute(c.id, c.args).ok).toBe(true);
    core.store.history.seal();
  };
  const own = () => (core.store.get(shape) as unknown as { anchors?: unknown }).anchors;
  return { core, shape, text, run, own };
}

describe('the inspector anchors (FR-ANC-006, FR-ANC-005)', () => {
  it('FR-ANC-006: a shape lists its anchors by name: its definition’s, then the defaults; anything else lists none', () => {
    const { core, shape, text } = setup();
    expect(anchorRows(core.store, shape, defs)?.map((r) => [r.name, r.custom])).toEqual([
      ['port', false],
      ['n', false],
      ['e', false],
      ['s', false],
      ['w', false],
      ['center', false],
    ]);
    expect(anchorRows(core.store, text, defs)).toBeUndefined();
    expect(anchorRows(core.store, 'nosuchrecord0001' as RecordId, defs)).toBeUndefined();
  });

  it('FR-ANC-005: a custom anchor is added under the first free name, moved within the box and removed, each one undo step', () => {
    const { core, shape, run, own } = setup();
    const added = addAnchor(core.store, shape, defs);
    expect(added?.name).toBe('a1');
    run(added?.command);
    expect(own()).toEqual([{ name: 'a1', x: 1, y: 0.25 }]);
    expect(anchorRows(core.store, shape, defs)?.[0]).toEqual({ name: 'a1', custom: true, x: 1, y: 0.25 });
    // a second one takes the next name
    expect(addAnchor(core.store, shape, defs)?.name).toBe('a2');
    // moved: the place stays within the box
    run(moveAnchor(core.store, shape, 'a1', { y: 1.5 }));
    expect(own()).toEqual([{ name: 'a1', x: 1, y: 1 }]);
    run(moveAnchor(core.store, shape, 'a1', { x: 0.3 }));
    expect(own()).toEqual([{ name: 'a1', x: 0.3, y: 1 }]);
    // one undo per change
    core.store.history.undo();
    expect(own()).toEqual([{ name: 'a1', x: 1, y: 1 }]);
    // only an anchor of its own moves or goes
    expect(moveAnchor(core.store, shape, 'n', { x: 0 })).toBeUndefined();
    expect(removeAnchor(core.store, shape, 'port')).toBeUndefined();
    run(removeAnchor(core.store, shape, 'a1'));
    expect(own()).toBeUndefined();
    core.store.history.undo();
    expect(own()).toEqual([{ name: 'a1', x: 1, y: 1 }]);
  });

  it('FR-ANC-005: a custom anchor named like a default one stands for it: listed once, as custom', () => {
    const { core, shape, run } = setup();
    run({ id: 'element.updateMany', args: { updates: [{ id: shape, fields: { anchors: [{ name: 'n', x: 0.2, y: 0 }] } }] } });
    const rows = anchorRows(core.store, shape, defs) ?? [];
    expect(rows.filter((r) => r.name === 'n')).toEqual([{ name: 'n', custom: true, x: 0.2, y: 0 }]);
    expect(addAnchor(core.store, shape, defs)?.name).toBe('a1');
  });

  it('FR-ANC-005: a custom anchor that places itself (a side anchor) is listed and removable but has no place to move; a move to where it is runs nothing', () => {
    const { core, shape, run } = setup();
    run({
      id: 'element.updateMany',
      args: {
        updates: [
          {
            id: shape,
            fields: {
              anchors: [
                { name: 'p', kind: 'side', side: 'e', t: 0.3 },
                { name: 'q', x: 1, y: 0 },
              ],
            },
          },
        ],
      },
    });
    const rows = anchorRows(core.store, shape, defs) ?? [];
    expect(rows.slice(0, 2)).toEqual([
      { name: 'p', custom: true },
      { name: 'q', custom: true, x: 1, y: 0 },
    ]);
    expect(moveAnchor(core.store, shape, 'p', { x: 0.5 })).toBeUndefined();
    expect(removeAnchor(core.store, shape, 'p')).toBeDefined();
    // past the box is kept at its edge: where q already is
    expect(moveAnchor(core.store, shape, 'q', { x: 1.5 })).toBeUndefined();
  });
});
