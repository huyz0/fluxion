// FR-LAY-003, NFR-LIC-002 (M17.20): the ELK pack registers layouts-elk:layered, :stress and :rectpacking when a host installs it, and each
// lays nodes out synchronously through elkjs.
import { describe, expect, it } from 'vitest';
import { engineOfScope, loadElkEngine, type ScopeLike } from './engine.js';
import { type ElkBox, type ElkLayoutInput, loadElkLayouts, registerElkLayouts, VERSION } from './index.js';

const box = (x: number, y: number, w = 100, h = 50): ElkBox => ({ x, y, w, h });
const chain: ElkLayoutInput = {
  frame: box(1000, 2000, 800, 600),
  nodes: [
    { id: 'c', box: box(0, 0), order: 3 },
    { id: 'a', box: box(0, 0), order: 1 },
    { id: 'b', box: box(0, 0, 160, 80), order: 2 },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b', order: 1 },
    { id: 'e2', source: 'b', target: 'c', order: 2 },
    { id: 'gone', source: 'a', target: 'nowhere', order: 3 },
  ],
};
const overlap = (p: ElkBox, q: ElkBox) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
const noOverlaps = (boxes: { readonly [id: string]: ElkBox }) => {
  const all = Object.values(boxes);
  return all.every((p, i) => all.every((q, j) => i === j || !overlap(p, q)));
};

describe('the ELK layouts pack (FR-LAY-003)', () => {
  it('FR-LAY-003: installing the pack registers the three ELK layouts under layouts-elk; nothing is listed before', async () => {
    expect(VERSION).toBe('0.0.0');
    const registered = new Map<string, string>();
    expect([...registered.keys()].filter((id) => id.startsWith('layouts-elk:'))).toEqual([]);
    const ids = await registerElkLayouts({
      register: (id, _value, source) => {
        if (registered.has(id)) return { ok: false };
        registered.set(id, source);
        return { ok: true };
      },
    });
    expect(ids).toEqual(['layouts-elk:layered', 'layouts-elk:stress', 'layouts-elk:rectpacking']);
    expect([...registered.values()]).toEqual(['layouts-elk', 'layouts-elk', 'layouts-elk']);
    // a second install finds the names taken and registers nothing
    expect(await registerElkLayouts({ register: (id) => ({ ok: !registered.has(id) }) })).toEqual([]);
  }, 30_000);

  it('FR-LAY-003: layered puts each node of a chain below the one before, in the frame, sizes kept, the same twice', async () => {
    const [layered] = await loadElkLayouts();
    const options = layered?.parseOptions(undefined);
    expect(options?.ok).toBe(true);
    if (!layered || !options?.ok) return;
    const { boxes } = layered.run(chain, options.value);
    const [a, b, c] = [boxes['a'], boxes['b'], boxes['c']] as [ElkBox, ElkBox, ElkBox];
    expect(a.y + a.h).toBeLessThanOrEqual(b.y);
    expect(b.y + b.h).toBeLessThanOrEqual(c.y);
    expect(Math.min(a.x, b.x, c.x)).toBeGreaterThanOrEqual(1000);
    expect(Math.min(a.y, b.y, c.y)).toBeGreaterThanOrEqual(2000);
    expect([b.w, b.h]).toEqual([160, 80]);
    expect(noOverlaps(boxes)).toBe(true);
    expect(layered.run(chain, options.value).boxes).toEqual(boxes);
  }, 30_000);

  it('FR-LAY-003: rectpacking and stress place every node without overlap; a pinned node keeps its box; bad options are refused', async () => {
    const [layered, stress, packing] = await loadElkLayouts();
    if (!layered || !stress || !packing) throw new Error('three layouts');
    for (const layout of [stress, packing]) {
      const parsed = layout.parseOptions({});
      if (!parsed.ok) throw new Error(parsed.message);
      const { boxes } = layout.run(chain, parsed.value);
      expect(Object.keys(boxes).sort()).toEqual(['a', 'b', 'c']);
      expect(noOverlaps(boxes)).toBe(true);
    }
    const pinned = { ...chain, nodes: chain.nodes.map((n) => (n.id === 'a' ? { ...n, box: box(5, 6), pinned: true } : n)) };
    const parsed = layered.parseOptions({ direction: 'right', gap: 20 });
    if (!parsed.ok) throw new Error(parsed.message);
    expect(layered.run(pinned, parsed.value).boxes['a']).toEqual(box(5, 6));
    expect(layered.parseOptions({ direction: 'sideways' })).toMatchObject({ ok: false, message: expect.stringContaining('direction') });
    expect(packing.parseOptions({ gap: -1 })).toMatchObject({ ok: false, message: expect.stringContaining('gap') });
  }, 30_000);

  it('FR-LAY-003: in a web worker, the dispatcher elkjs installs as onmessage answers through postMessage, swapped back after the call', () => {
    const answers: unknown[] = [];
    const scope: ScopeLike = { onmessage: null, postMessage: ((m: unknown) => answers.push(m)) as ScopeLike['postMessage'] };
    const original = scope.postMessage;
    const dispatch = (event: { readonly data: unknown }) => {
      const { id, cmd, graph } = event.data as { id: number; cmd: string; graph: { id: string } };
      (scope.postMessage as (m: unknown) => void)({ id, data: cmd === 'layout' ? { ...graph, laid: true } : undefined });
    };
    const engine = engineOfScope(scope, dispatch);
    expect(engine({ id: 'root' })).toEqual({ id: 'root', laid: true });
    expect(scope.postMessage).toBe(original);
    expect(answers).toEqual([]);
    const failing = engineOfScope(scope, (event) => {
      const { id, cmd } = event.data as { id: number; cmd: string };
      (scope.postMessage as (m: unknown) => void)(cmd === 'layout' ? { id, error: { message: 'no such algorithm' } } : { id });
    });
    expect(() => failing({ id: 'root' })).toThrow('no such algorithm');
    expect(scope.postMessage).toBe(original);
  });

  it('FR-LAY-003: elkjs is loaded once per realm: every load, concurrent or later, gives the same engine', async () => {
    const [first, second] = await Promise.all([loadElkEngine(), loadElkEngine()]);
    expect(second).toBe(first);
    expect(await loadElkEngine()).toBe(first);
  }, 30_000);
});
