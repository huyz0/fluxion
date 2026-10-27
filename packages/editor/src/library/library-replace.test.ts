import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { AnchorRef, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createSession } from '../session.js';
import { replaceableShape, replaceSelectedShape } from './library-replace.js';

const def = (id: string, anchors?: ShapeDef['anchors']): ShapeDef =>
  ({ id, outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 100, h: 60 }, ...(anchors ? { anchors } : {}) }) as unknown as ShapeDef;

function setup() {
  const b = documentBuilder({ seed: 137 });
  const screen = b.screen();
  const rect = b.rect(screen, { x: 0, y: 0, label: 'Web' });
  const other = b.rect(screen, { x: 400, y: 0 });
  const line = b.connect(rect, other, { sourceAnchor: { kind: 'named', name: 'out' } });
  const core = createCore(b.build());
  const session = createSession('doc');
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  for (const d of [def('basic:rect', [{ name: 'out', x: 1, y: 0.4 }]), def('basic:ellipse')]) shapeDefs.register(d.id, d, 'test');
  const deps = { view: core.store, execute: core.execute, session, shapeDefs };
  const source = () =>
    core.store
      .members('byType', 'binding')
      .map((x) => core.store.get(x) as unknown as { connectorId: string; end: string; elementId: string; anchor: AnchorRef })
      .find((x) => x.connectorId === line && x.end === 'source');
  return { core, session, deps, rect, other, line, source };
}

describe('library replace (FR-LIB-011)', () => {
  it('FR-LIB-011: WHEN the selected shape is replaced from the library THE SYSTEM SHALL keep its text and connectors, mapping its anchors, in one undo', () => {
    const { core, session, deps, rect, source } = setup();
    session.selection.set([rect]);
    const before = core.store.toDocument();
    expect(replaceSelectedShape(deps, 'basic:ellipse')).toBe(true);
    const shape = core.store.get(rect) as unknown as { defId: string; text: unknown };
    expect(shape.defId).toBe('basic:ellipse');
    expect(shape.text).toEqual((before.records[rect] as unknown as { text: unknown }).text);
    // the rect's own `out` (1, 0.4) is nearest the ellipse's default e (1, 0.5)
    expect(source()).toMatchObject({ elementId: rect, anchor: { kind: 'named', name: 'e' } });
    expect(session.selection.get()).toEqual([rect]);
    expect(session.library.get()).toBe('basic:ellipse');
    core.store.history.undo();
    expect(core.store.toDocument()).toEqual(before);
  });

  it('FR-LIB-011: nothing is replaced without exactly one selected shape, for an unknown definition, or for its own', () => {
    const { core, session, deps, rect, other, line } = setup();
    const before = core.store.toDocument();
    for (const selection of [[], [rect, other], [line]] as RecordId[][]) {
      session.selection.set(selection);
      expect(replaceSelectedShape(deps, 'basic:ellipse')).toBe(false);
    }
    expect(replaceableShape(core.store, [line])).toBeUndefined();
    session.selection.set([rect]);
    expect(replaceableShape(core.store, [rect])).toBe(rect);
    expect(replaceSelectedShape(deps, 'basic:nope')).toBe(false);
    expect(replaceSelectedShape(deps, 'basic:rect')).toBe(false);
    expect(core.store.toDocument()).toEqual(before);
  });
});
