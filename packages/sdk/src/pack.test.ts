import { createCoreRegistries, type MarkerDef, type ShapeDef } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { definePack, registerShapeDef } from './pack.js';

const shape = (id: string, extra: Partial<ShapeDef> = {}): ShapeDef =>
  ({ id, outline: { path: 'M 0 0 L {w} {h}' }, defaultSize: { w: 10, h: 10 }, ...extra }) as ShapeDef;
const codes = (r: { ok: boolean; error?: readonly { code: string; path: string }[] }) => (r.ok ? [] : (r.error ?? []).map((d) => `${d.code} ${d.path}`));

describe('packs (ADR-0017)', () => {
  it('FR-EXT-001: definePack registers its shape definitions through the registry API', () => {
    const registries = createCoreRegistries();
    const pack = definePack({ id: 'demo', shapes: [shape('demo:a'), shape('demo:b')] });
    expect(pack.id).toBe('demo');
    const r = pack.register(registries);
    expect(r.ok).toBe(true);
    expect(registries.shapeDefs.get('demo:a')).toEqual(shape('demo:a'));
    expect(registries.shapeDefs.source('demo:b')).toBe('demo');
    // the same source may register again (a reload); disposing removes everything it added
    const again = pack.register(registries);
    expect(again.ok).toBe(true);
    if (again.ok) again.value.dispose();
    expect(registries.shapeDefs.get('demo:a')).toBeUndefined();
    expect(registries.shapeDefs.get('demo:b')).toBeUndefined();
    expect(definePack({ id: 'empty' }).shapes).toEqual([]);
    expect(definePack({ id: 'empty' }).register(registries).ok).toBe(true);
  });

  it('FR-EXT-001: a pack registers all of its definitions or none, with every problem reported', () => {
    const registries = createCoreRegistries();
    expect(codes(definePack({ id: 'Demo', shapes: [shape('demo:a')] }).register(registries))).toEqual(['FLX_PACK_INVALID /id']);
    expect(codes(definePack({ id: 'demo', shapes: [shape('other:a')] }).register(registries))).toEqual(['FLX_PACK_INVALID /shapes/0/id']);
    const message = (r: ReturnType<ReturnType<typeof definePack>['register']>) => (r.ok ? '' : r.error[0]?.message);
    expect(message(definePack({ id: 'demo_x' }).register(registries))).toBe('pack id "demo_x" must be lower-case letters, digits and "-"');
    expect(message(definePack({ id: 'demo', shapes: [shape('other:a')] }).register(registries))).toBe(
      'shape id "other:a" is outside the namespace "demo:" of demo',
    );
    expect(definePack({ id: '9-lives' }).register(registries).ok).toBe(true);
    // every invalid definition is reported, and nothing is registered
    const broken = definePack({
      id: 'demo',
      shapes: [shape('demo:ok'), shape('demo:x', { defaultSize: { w: 0, h: 1 } }), { id: 'demo:y' } as unknown as ShapeDef],
    });
    const r = broken.register(registries);
    expect(codes(r).every((c) => c.startsWith('FLX_SHAPE_DEF_INVALID /shapes/'))).toBe(true);
    expect(codes(r).some((c) => c.startsWith('FLX_SHAPE_DEF_INVALID /shapes/1/'))).toBe(true);
    expect(codes(r).some((c) => c.startsWith('FLX_SHAPE_DEF_INVALID /shapes/2/'))).toBe(true);
    expect(registries.shapeDefs.get('demo:ok')).toBeUndefined();
    // a key another source holds refuses the pack and undoes what it had registered
    expect(registerShapeDef(registries, shape('demo:taken'), 'intruder').ok).toBe(false);
    registries.shapeDefs.register('demo:taken', shape('demo:taken'), 'intruder');
    const clash = definePack({ id: 'demo', shapes: [shape('demo:first'), shape('demo:taken')] }).register(registries);
    expect(codes(clash)).toEqual(['FLX_REGISTRY_DUPLICATE /shapes/1/id']);
    expect(registries.shapeDefs.get('demo:first')).toBeUndefined();
    expect(registries.shapeDefs.source('demo:taken')).toBe('intruder');
    // a failed reload leaves the live registration as it was (M5.8 review F1)
    const v1 = definePack({ id: 'demo', shapes: [shape('demo:first')] });
    expect(v1.register(registries).ok).toBe(true);
    const v2 = definePack({ id: 'demo', shapes: [shape('demo:first', { category: 'v2' }), shape('demo:taken')] });
    expect(codes(v2.register(registries))).toEqual(['FLX_REGISTRY_DUPLICATE /shapes/1/id']);
    expect(registries.shapeDefs.get('demo:first')).toEqual(shape('demo:first'));
    // every namespace problem and every repeated id is reported (M5.8 review F2)
    const messy = definePack({ id: 'demo', shapes: [shape('other:a'), shape('other:b'), shape('demo:c'), shape('demo:c')] });
    const all = messy.register(registries);
    expect(codes(all)).toEqual(['FLX_PACK_INVALID /shapes/0/id', 'FLX_PACK_INVALID /shapes/1/id', 'FLX_PACK_INVALID /shapes/3/id']);
    expect(all.ok ? '' : all.error[2]?.message).toBe('shape id "demo:c" is defined twice (also /shapes/2)');
    expect(all.ok ? '' : all.error[0]?.message).toBe('shape id "other:a" is outside the namespace "demo:" of demo');
    expect(registries.shapeDefs.get('demo:c')).toBeUndefined();
    const dup = definePack({ id: 'demo', shapes: [shape('demo:taken')] }).register(registries);
    expect(dup.ok ? '' : dup.error[0]?.message).toBe('"demo:taken" is already registered in shapeDefs by intruder');
  });

  it('FR-EXT-001: a pack registers its connector markers too, all of them with its shapes or none (ADR-0017 amendment)', () => {
    const registries = createCoreRegistries();
    const marker = (id: string, extra: Partial<MarkerDef> = {}): MarkerDef => ({ id, path: 'M0 0 L10 5 L0 10', inset: 0, filled: false, ...extra });
    const pack = definePack({ id: 'demo', shapes: [shape('demo:a')], markers: [marker('demo:m'), marker('demo:n', { filled: true, inset: 10 })] });
    expect(pack.markers.map((m) => m.id)).toEqual(['demo:m', 'demo:n']);
    expect(definePack({ id: 'bare' }).markers).toEqual([]);
    const r = pack.register(registries);
    expect(r.ok).toBe(true);
    expect([registries.markers.get('demo:m'), registries.markers.source('demo:n')]).toEqual([marker('demo:m'), 'demo']);
    if (r.ok) r.value.dispose();
    expect([registries.markers.get('demo:m'), registries.shapeDefs.get('demo:a')]).toEqual([undefined, undefined]);
    // every marker problem is reported, and nothing (shapes included) is registered
    registries.markers.register('demo:held', marker('demo:held'), 'other');
    const broken = definePack({
      id: 'demo',
      shapes: [shape('demo:ok')],
      markers: [
        marker('demo:m', { inset: 12 }),
        marker('else:m'),
        marker('demo:x'),
        marker('demo:x'),
        marker('demo:held'),
        marker('demo:t', { path: 'M0 0 L{w} 5' }),
      ],
    }).register(registries);
    expect(codes(broken)).toEqual([
      'FLX_PACK_INVALID /markers/0/inset',
      'FLX_PACK_INVALID /markers/1/id',
      'FLX_PACK_INVALID /markers/3/id',
      'FLX_REGISTRY_DUPLICATE /markers/4/id',
      'FLX_PACK_INVALID /markers/5/path',
    ]);
    expect(broken.ok ? [] : broken.error.map((d) => d.message).slice(1, 4)).toEqual([
      'marker id "else:m" is outside the namespace "demo:" of demo',
      'marker id "demo:x" is defined twice (also /markers/2)',
      '"demo:held" is already registered in markers by other',
    ]);
    expect([registries.shapeDefs.get('demo:ok'), registries.markers.get('demo:x')]).toEqual([undefined, undefined]);
  });

  it('registerShapeDef validates one definition of unknown shape against its source namespace', () => {
    const registries = createCoreRegistries();
    expect(codes(registerShapeDef(registries, { id: 'x:a' }, 'x', ['defs', 3]))[0]).toMatch(/^FLX_SHAPE_DEF_INVALID \/defs\/3\//);
    expect(codes(registerShapeDef(registries, shape('y:a'), 'x'))).toEqual(['FLX_PACK_INVALID /id']);
    // "x:" is the namespace, not a prefix of it
    expect(codes(registerShapeDef(registries, shape('xy:a'), 'x'))).toEqual(['FLX_PACK_INVALID /id']);
    const ok = registerShapeDef(registries, shape('x:a'), 'x');
    expect(ok.ok).toBe(true);
    expect(registries.shapeDefs.source('x:a')).toBe('x');
  });
});
