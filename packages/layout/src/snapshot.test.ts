// FR-LAY-005: the snapshot builder turns document records into a layout input for a screen, a selection or a container.
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotRecord } from './snapshot.js';

const box = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h });
const el = (id: string, index: string, extra: Record<string, unknown> = {}): SnapshotRecord => ({
  id,
  type: 'element',
  screenId: 's1',
  kind: 'shape',
  index,
  transform: box(0, 0),
  ...extra,
});

// a screen: a frame "box" holding two shapes (one pinned), a free shape, a connector between the free shape and one in the frame, a hidden
// shape, a shape on another screen
const RECORDS: readonly SnapshotRecord[] = [
  { id: 'doc', type: 'document' },
  { id: 's1', type: 'screen', index: 'a0' },
  el('free', 'a0', { transform: box(10, 20, 120, 60), semantic: { slug: 'free', label: 'Free', role: 'service', tags: ['edge'], lane: 2, nested: { x: 1 } } }),
  el('frame', 'a1', { kind: 'frame', transform: box(300, 40, 400, 300) }),
  el('inA', 'a2', { parentId: 'frame', transform: box(320, 60), placement: 'pinned' }),
  el('inB', 'a3', { parentId: 'frame', transform: box(450, 60), locks: { position: true } }),
  el('inC', 'a4', { parentId: 'frame', transform: box(320, 160) }),
  { id: 'wire', type: 'element', screenId: 's1', kind: 'connector', index: 'a5' },
  { id: 'b1', type: 'binding', connectorId: 'wire', end: 'source', elementId: 'free' },
  { id: 'b2', type: 'binding', connectorId: 'wire', end: 'target', elementId: 'inC' },
  el('gone', 'a6', { hidden: true }),
  { ...el('other', 'a7'), screenId: 's2' },
];

const FRAME = box(0, 0, 1000, 700);

const wire = (id: string, extra: Record<string, unknown> = {}): SnapshotRecord => ({
  id,
  type: 'element',
  screenId: 's1',
  kind: 'connector',
  index: 'c0',
  ...extra,
});
const bind = (id: string, connectorId: string, end: string, elementId: string): SnapshotRecord => ({ id, type: 'binding', connectorId, end, elementId });

describe('snapshot builder (FR-LAY-005)', () => {
  it('FR-LAY-005: the snapshot of a screen equals its golden input', () => {
    expect(buildSnapshot(RECORDS, { screenId: 's1', frame: FRAME })).toEqual({
      nodes: [
        { id: 'free', box: box(10, 20, 120, 60), order: 0, hints: { lane: 2, role: 'service', tags: ['edge'] } },
        { id: 'frame', box: box(300, 40, 400, 300), order: 1 },
        { id: 'inA', box: box(320, 60), order: 2, pinned: true, parentId: 'frame' },
        { id: 'inB', box: box(450, 60), order: 3, pinned: true, parentId: 'frame' },
        { id: 'inC', box: box(320, 160), order: 4, parentId: 'frame' },
      ],
      edges: [{ id: 'wire', source: 'free', target: 'inC', order: 5 }],
      frame: FRAME,
      scope: 'screen',
    });
  });

  it('FR-LAY-005: a selection scope keeps the selected nodes and the edges between them, and drops a parent that is not selected', () => {
    const input = buildSnapshot(RECORDS, { screenId: 's1', scope: 'selection', selection: ['free', 'inC', 'inA', 'unknown'], frame: FRAME });
    expect(input.nodes.map((n) => [n.id, n.parentId])).toEqual([
      ['free', undefined],
      ['inA', undefined],
      ['inC', undefined],
    ]);
    expect(input.edges.map((e) => e.id)).toEqual(['wire']);
    const alone = buildSnapshot(RECORDS, { screenId: 's1', scope: 'selection', selection: ['free'], frame: FRAME });
    expect(alone.edges).toEqual([]);
  });

  it("FR-LAY-005: a container scope covers the container's descendants, frames on its own box, and keeps nested parents", () => {
    const nested: readonly SnapshotRecord[] = [
      ...RECORDS,
      el('deep', 'a8', { parentId: 'inC', kind: 'frame', transform: box(330, 170, 60, 40) }),
      el('leaf', 'a9', { parentId: 'deep' }),
    ];
    const input = buildSnapshot(nested, { screenId: 's1', scope: { containerId: 'frame' } });
    expect(input.nodes.map((n) => [n.id, n.parentId])).toEqual([
      ['inA', undefined],
      ['inB', undefined],
      ['inC', undefined],
      ['deep', 'inC'],
      ['leaf', 'deep'],
    ]);
    expect(input.frame).toEqual(box(300, 40, 400, 300));
    expect(input.scope).toEqual({ containerId: 'frame' });
    expect(input.edges).toEqual([]);
  });

  it('FR-LAY-005: the snapshot does not depend on the order of the records, and hidden, other-screen and boxless elements are left out', () => {
    const a = buildSnapshot(RECORDS, { screenId: 's1', frame: FRAME });
    const b = buildSnapshot([...RECORDS].reverse(), { screenId: 's1', frame: FRAME });
    expect(b).toEqual(a);
    const broken = [el('nobox', 'b0', { transform: { x: 1, y: 'two' } }), el('noindex', 'b1', { index: 3 }), el('ok', 'b2')];
    expect(buildSnapshot(broken, { screenId: 's1' }).nodes.map((n) => n.id)).toEqual(['ok']);
    expect(buildSnapshot(broken, { screenId: 's1' }).frame).toEqual(box(0, 0, 1920, 1080));
  });

  it('FR-LAY-005: hints are the role, tags and plain data of the semantic field, never the slug or label', () => {
    const node = buildSnapshot([el('x', 'a0', { semantic: { slug: 'x', label: 'X', rank: 3, side: 'left', pinnedLane: true, data: { a: 1 }, tags: ['t'] } })], {
      screenId: 's1',
    }).nodes[0];
    expect(node?.hints).toEqual({ pinnedLane: true, rank: 3, side: 'left', tags: ['t'] });
    expect(buildSnapshot([el('y', 'a0', { semantic: { slug: 'y', label: 'Y' } })], { screenId: 's1' }).nodes[0]).not.toHaveProperty('hints');
  });

  it('FR-LAY-005: a connector with one bound end, a hidden connector, one on another screen or bound outside the set is not an edge', () => {
    const base = [el('p', 'a0'), el('q', 'a1'), el('hid', 'a2', { hidden: true })];
    const records: readonly SnapshotRecord[] = [
      ...base,
      wire('half'),
      bind('h1', 'half', 'source', 'p'),
      wire('hiddenWire', { hidden: true }),
      bind('w1', 'hiddenWire', 'source', 'p'),
      bind('w2', 'hiddenWire', 'target', 'q'),
      wire('elsewhere', { screenId: 's2' }),
      bind('e1', 'elsewhere', 'source', 'p'),
      bind('e2', 'elsewhere', 'target', 'q'),
      wire('toHidden'),
      bind('t1', 'toHidden', 'source', 'p'),
      bind('t2', 'toHidden', 'target', 'hid'),
      wire('good'),
      bind('g1', 'good', 'source', 'p'),
      bind('g2', 'good', 'target', 'q'),
    ];
    expect(buildSnapshot(records, { screenId: 's1' }).edges.map((e) => [e.id, e.source, e.target])).toEqual([['good', 'p', 'q']]);
  });

  it('FR-LAY-005: two bindings for one end resolve by binding id, whatever the record order', () => {
    const records: readonly SnapshotRecord[] = [
      el('p', 'a0'),
      el('q', 'a1'),
      el('r', 'a2'),
      wire('w'),
      bind('b1', 'w', 'source', 'p'),
      bind('b2', 'w', 'source', 'r'),
      bind('b3', 'w', 'target', 'q'),
    ];
    const forward = buildSnapshot(records, { screenId: 's1' }).edges;
    expect(buildSnapshot([...records].reverse(), { screenId: 's1' }).edges).toEqual(forward);
    expect(forward.map((e) => e.source)).toEqual(['r']);
  });

  it('FR-LAY-005: hidden hides the whole subtree, and a container scope on a hidden container has nothing to lay out', () => {
    const records: readonly SnapshotRecord[] = [
      el('shown', 'a0'),
      el('box', 'a1', { kind: 'frame', hidden: true, transform: box(50, 50, 300, 200) }),
      el('inside', 'a2', { parentId: 'box' }),
      el('deeper', 'a3', { parentId: 'inside' }),
    ];
    expect(buildSnapshot(records, { screenId: 's1' }).nodes.map((n) => n.id)).toEqual(['shown']);
    const container = buildSnapshot(records, { screenId: 's1', scope: { containerId: 'box' } });
    expect(container.nodes).toEqual([]);
    expect(container.frame).toEqual(box(50, 50, 300, 200));
  });

  it('FR-LAY-005: tag hints keep strings only and are copies, and a rotated element keeps its stored footprint', () => {
    const semantic = { tags: ['a', 3, {}, 'b'] };
    const record = el('x', 'a0', { semantic, transform: { ...box(0, 0, 80, 40), rot: 90 } });
    const node = buildSnapshot([record], { screenId: 's1' }).nodes[0];
    expect(node?.hints).toEqual({ tags: ['a', 'b'] });
    expect(node?.hints?.['tags']).not.toBe(semantic.tags);
    expect(node?.box).toEqual(box(0, 0, 80, 40));
  });
});
