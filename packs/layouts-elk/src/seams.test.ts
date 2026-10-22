// FR-LAY-003 (M17.20): the seams of the ELK pack: a dispatcher's answer and its errors, the graph ELK is given (dangling and self edges, tied
// orders) and the boxes it gives back (a node ELK left out, a node without a position).
import { describe, expect, it } from 'vitest';
import { engineOfLoad, engineOfModule, engineOfScope, type ScopeLike } from './engine.js';
import { boxesOf, type ElkBox, type ElkLayoutInput, elkGraph, elkLayouts } from './layouts.js';

const box = (x: number, y: number, w = 100, h = 50): ElkBox => ({ x, y, w, h });

/** A scope whose dispatcher answers `error` to every layout command. */
function failing(error: unknown) {
  const scope: ScopeLike = { onmessage: null, postMessage: (() => undefined) as ScopeLike['postMessage'] };
  return engineOfScope(scope, (event) => {
    const { id, cmd } = event.data as { id: number; cmd: string };
    (scope.postMessage as (m: unknown) => void)(cmd === 'layout' ? { id, error } : { id });
  });
}

describe('the ELK pack seams (FR-LAY-003)', () => {
  it('FR-LAY-003: a module that exports no worker gives no engine; a dispatcher that never answers is an error', () => {
    expect(engineOfModule({})).toBeUndefined();
    expect(() => engineOfScope({ onmessage: null, postMessage: () => undefined }, () => undefined)).toThrow('ELK gave no answer');
  });

  it('FR-LAY-003: an ELK error keeps its words whether it came as an Error, an object with a message or a string', () => {
    expect(() => failing(new RangeError('range'))({ id: 'root' })).toThrow(RangeError);
    expect(() => failing({ message: 'object text' })({ id: 'root' })).toThrow('object text');
    expect(() => failing('plain text')({ id: 'root' })).toThrow('plain text');
  });

  it('FR-LAY-003: the graph given to ELK is in model order, drops edges with an unknown end or a loop, and breaks ties by id', () => {
    const input: ElkLayoutInput = {
      frame: box(0, 0),
      nodes: [
        { id: 'b', box: box(0, 0), order: 1 },
        { id: 'a', box: box(0, 0), order: 1 },
      ],
      edges: [
        { id: 'dangling', source: 'a', target: 'zz', order: 1 },
        { id: 'loop', source: 'a', target: 'a', order: 2 },
        { id: 'w2', source: 'a', target: 'b', order: 4 },
        { id: 'w1', source: 'b', target: 'a', order: 4 },
      ],
    };
    const graph = elkGraph(input, {});
    expect(graph.children?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(graph.edges?.map((e) => e.id)).toEqual(['w1', 'w2']);
  });

  it('FR-LAY-003: a node ELK left out, or placed without a position, keeps its box; a placed node is moved into the frame on half pixels', () => {
    const input: ElkLayoutInput = {
      frame: box(1000, 2000),
      nodes: [
        { id: 'p', box: box(1, 2), order: 1 },
        { id: 'q', box: box(3, 4), order: 2 },
        { id: 'r', box: box(5, 6), order: 3 },
      ],
    };
    const laid = {
      id: 'root',
      children: [
        { id: 'p', x: undefined, y: undefined },
        { id: 'q', x: 10.3, y: 4.2 },
      ],
    };
    expect(boxesOf(input, laid as never)).toEqual({ p: box(1, 2), q: box(1010.5, 2004), r: box(5, 6) });
  });
});

describe('the ELK pack loader and options (FR-LAY-003)', () => {
  it('FR-LAY-003: a loaded elkjs gives its exported engine, else the dispatcher it installed on the worker scope, which gets its handler back', () => {
    // a fake worker whose dispatcher answers every command, as elkjs's does
    class Fake {
      onmessage: ((event: { data: unknown }) => void) | undefined;
      dispatcher = { saveDispatch: (event: { data: { id: number } }) => this.onmessage?.({ data: { id: event.data.id } }) };
    }
    expect(engineOfLoad({ default: { Worker: Fake } as never }, undefined, undefined)).toBeTypeOf('function');
    expect(() => engineOfLoad({}, undefined, undefined)).toThrow('elkjs did not load');
    const scope: ScopeLike = { onmessage: null, postMessage: () => undefined };
    scope.onmessage = (event: { data: { id: number } }) => (scope.postMessage as (m: unknown) => void)({ id: event.data.id });
    const handler = scope.onmessage;
    const engine = engineOfLoad({}, scope, null);
    expect(engine).toBeTypeOf('function');
    expect(scope.onmessage).toBe(null);
    expect(handler).toBeTypeOf('function');
    expect(() => engineOfLoad({}, { onmessage: null, postMessage: () => undefined }, null)).toThrow('elkjs did not load');
  });

  it('FR-LAY-003: options that are not an object name the problem at the top; an option names itself', () => {
    const [layout] = elkLayouts(() => ({ id: 'root' }));
    expect(layout?.parseOptions('text')).toMatchObject({ ok: false, message: expect.stringMatching(/^options: /) });
    expect(layout?.parseOptions(undefined)).toMatchObject({ ok: true });
  });
});

describe('the ELK pack graph and boxes at the edges (FR-LAY-003)', () => {
  it('FR-LAY-003: an answer with no children keeps every box; nodes tied on order come out by id, whichever order they were given in', () => {
    const input: ElkLayoutInput = { frame: box(0, 0), nodes: [{ id: 'k', box: box(7, 8), order: 1 }] };
    expect(boxesOf(input, { id: 'root' })).toEqual({ k: box(7, 8) });
    const tied: ElkLayoutInput = {
      frame: box(0, 0),
      nodes: [
        { id: 'm', box: box(0, 0), order: 2 },
        { id: 'c', box: box(0, 0), order: 2 },
        { id: 'x', box: box(0, 0), order: 2 },
      ],
    };
    expect(elkGraph(tied, {}).children?.map((c) => c.id)).toEqual(['c', 'm', 'x']);
  });
});
