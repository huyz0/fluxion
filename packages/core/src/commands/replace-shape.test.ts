import type { AnchorDef, AnchorRef, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { DEFAULT_ANCHOR_DEFS, mapAnchor } from '../shape/replace.js';
import { RecordStore } from '../store.js';

const PORT: AnchorDef = { name: 'port', x: 0.8, y: 0.1 };

/** A styled, labelled rect with four connectors bound by default, custom, side and floating anchors, and the command runner. */
function setup() {
  const b = documentBuilder({ seed: 118 });
  const screen = b.screen();
  const rect = b.rect(screen, { x: 100, y: 100, w: 160, h: 100, label: 'Server', style: { variant: 'emphasis' } });
  const other = b.rect(screen, { x: 500, y: 100 });
  const anchors: AnchorRef[] = [{ kind: 'named', name: 'n' }, { kind: 'named', name: 'port' }, { kind: 'side', side: 'e', t: 0.25 }, { kind: 'floating' }];
  const connectors = anchors.map((anchor) => b.connect(rect, other, { sourceAnchor: anchor, route: 'orthogonal' }));
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const bindingsOf = (x: RecordId) =>
    store
      .members('byType', 'binding')
      .map((id) => store.get(id) as unknown as { connectorId: string; end: string; elementId: string; anchor: AnchorRef })
      .filter((r) => r.elementId === x)
      .sort((p, q) => (p.connectorId < q.connectorId ? -1 : 1));
  return { store, run, rect, other, connectors, bindingsOf };
}

describe('replace shape (FR-LIB-011)', () => {
  it('FR-LIB-011: WHEN rect is replaced by ellipse THE SYSTEM SHALL keep text, style and every connector bound, mapping anchors by name then nearest', () => {
    const { store, run, rect, connectors, bindingsOf } = setup();
    const before = store.get(rect) as unknown as Record<string, unknown>;
    const r = run('shape.replace', { id: rect, defId: 'basic:ellipse', fromAnchors: [PORT], toAnchors: [] });
    expect(r.ok).toBe(true);
    const after = store.get(rect) as unknown as Record<string, unknown>;
    expect(after['defId']).toBe('basic:ellipse');
    expect(after['text']).toEqual(before['text']);
    expect(after['style']).toEqual(before['style']);
    expect(after['transform']).toEqual(before['transform']);
    const bound = bindingsOf(rect);
    expect(bound.map((x) => x.connectorId).sort()).toEqual([...connectors].sort());
    const byConnector = Object.fromEntries(bound.map((x) => [x.connectorId, x.anchor]));
    // n exists on every shape; port (0.8, 0.1) is nearest n (0.5, 0); side and floating are box fractions and stay
    expect(connectors.map((c) => byConnector[c])).toEqual([
      { kind: 'named', name: 'n' },
      { kind: 'named', name: 'n' },
      { kind: 'side', side: 'e', t: 0.25 },
      { kind: 'floating' },
    ]);
  });

  it('FR-LIB-011: one undo restores the original shape and bindings exactly, and redo replays the replacement', () => {
    const { store, run, rect } = setup();
    const original = store.toDocument();
    const depth = store.history.undoDepth;
    expect(run('shape.replace', { id: rect, defId: 'basic:ellipse', fromAnchors: [PORT], toAnchors: [], params: { k: 1 } }).ok).toBe(true);
    const replaced = store.toDocument();
    expect(store.history.undoDepth).toBe(depth + 1);
    store.history.undo();
    expect(store.toDocument()).toEqual(original);
    store.history.redo();
    expect(store.toDocument()).toEqual(replaced);
  });

  it("FR-LIB-011: a name the new definition has is kept; the old definition's params and the instance's anchors are dropped", () => {
    const { store, run, rect, connectors, bindingsOf } = setup();
    expect(run('element.update', { id: rect, fields: { params: { r: 4 }, anchors: [PORT] } }).ok).toBe(true);
    const moved: AnchorDef = { name: 'port', x: 0.2, y: 0.9 };
    expect(run('shape.replace', { id: rect, defId: 'flow:decision', toAnchors: [moved], params: { skew: 2 } }).ok).toBe(true);
    const after = store.get(rect) as unknown as Record<string, unknown>;
    expect(after['params']).toEqual({ skew: 2 });
    expect('anchors' in after).toBe(false);
    expect(bindingsOf(rect).find((x) => x.connectorId === connectors[1])?.anchor).toEqual({ kind: 'named', name: 'port' });
  });

  it('FR-LIB-011: a non-shape or missing id is refused and the store is unchanged', () => {
    const { store, run, rect, connectors } = setup();
    const original = store.toDocument();
    const depth = store.history.undoDepth;
    for (const id of [connectors[0], 'nope']) {
      const r = run('shape.replace', { id, defId: 'basic:ellipse' });
      expect(r.ok ? 'ok' : r.error.code).toBe('COMMAND_ARGS');
    }
    const unqualified = run('shape.replace', { id: rect, defId: 'not qualified' });
    expect(unqualified.ok ? 'ok' : unqualified.error.code).toBe('COMMAND_ARGS');
    expect(store.toDocument()).toEqual(original);
    expect(store.history.undoDepth).toBe(depth);
  });

  it('FR-LIB-011: a perimeter anchor the new definition lacks floats; an unknown name and non-named anchors are unchanged', () => {
    const from: AnchorDef[] = [{ name: 'rim', kind: 'perimeter' }, ...DEFAULT_ANCHOR_DEFS];
    const to = [...DEFAULT_ANCHOR_DEFS];
    expect(mapAnchor({ kind: 'named', name: 'rim' }, from, to)).toEqual({ kind: 'floating' });
    const unknown: AnchorRef = { kind: 'named', name: 'ghost' };
    expect(mapAnchor(unknown, from, to)).toBe(unknown);
    const point: AnchorRef = { kind: 'point', x: 0.3, y: 0.3 };
    expect(mapAnchor(point, from, to)).toBe(point);
    // side and centre anchor defs map by their box position
    const side: AnchorDef = { name: 'low', kind: 'side', side: 's', t: 0.9 };
    const target: AnchorDef[] = [
      { name: 'a', kind: 'center' },
      { name: 'b', kind: 'side', side: 's', t: 1 },
    ];
    expect(mapAnchor({ kind: 'named', name: 'low' }, [side], target)).toEqual({ kind: 'named', name: 'b' });
    expect(mapAnchor({ kind: 'named', name: 'low' }, [side], [{ name: 'rim', kind: 'perimeter' }])).toEqual({ kind: 'floating' });
  });

  it('FR-LIB-011: a mapped named anchor always names an anchor of the new definition (property)', () => {
    const anchor = fc.record({
      name: fc.constantFrom('a', 'b', 'c', 'd', 'n', 'e'),
      x: fc.double({ min: 0, max: 1, noNaN: true }),
      y: fc.double({ min: 0, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(anchor, { minLength: 1 }), fc.array(anchor), fc.nat(), (from, toOwn, k) => {
        const to = [...toOwn, ...DEFAULT_ANCHOR_DEFS];
        const name = (from[k % from.length] as AnchorDef).name;
        const mapped = mapAnchor({ kind: 'named', name }, from, to);
        return mapped.kind === 'named' && to.some((a) => a.name === mapped.name);
      }),
    );
  });
});
