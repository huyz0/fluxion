// FR-LAY-007: layout runs in a worker without blocking the caller, can be cancelled, and the newest revision of a scope wins.
import { describe, expect, it } from 'vitest';
import { gridLayout, layeredLayout, layoutSync, stackLayout } from '../index.js';
import type { LayoutInput } from '../types.js';
import {
  type AbortSignalWithEvents,
  createLayoutHost,
  type HostJob,
  type LayoutJobMessage,
  serveLayoutWorker,
  type WorkerLike,
  type WorkerScopeLike,
} from './index.js';

const input: LayoutInput = {
  frame: { x: 0, y: 0, w: 1920, h: 1080 },
  nodes: [
    { id: 'a', box: { x: 0, y: 0, w: 100, h: 50 }, order: 0 },
    { id: 'b', box: { x: 0, y: 0, w: 100, h: 50 }, order: 1 },
  ],
  edges: [{ id: 'e', source: 'a', target: 'b', order: 0 }],
};
const lookup = (name: string) => ({ stack: stackLayout, grid: gridLayout, layered: layeredLayout })[name as 'stack'] as never;
const job = (extra: Partial<HostJob> = {}): HostJob => ({ scope: 's1', revision: 1, algorithm: 'layered', input, ...extra });

/** A worker the test drives by hand: it records what it is sent and says nothing until told to. */
class ManualWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onerror'] = null;
  failToSend: Error | undefined;
  readonly sent: LayoutJobMessage[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    if (this.failToSend) throw this.failToSend;
    this.sent.push(message as LayoutJobMessage);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** What the worker would say, delivered now (also after termination: a late reply the host must ignore). */
  say(data: unknown): void {
    this.onmessage?.({ data });
  }
}

/** A worker that really runs the layout handler, answering on a later microtask like a real one. */
class LoopbackWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  terminated = false;
  constructor() {
    const scope: WorkerScopeLike = {
      onmessage: null,
      postMessage: (reply) => void Promise.resolve().then(() => this.onmessage?.({ data: reply })),
    };
    serveLayoutWorker(scope, lookup);
    this.scope = scope;
  }
  readonly scope: WorkerScopeLike;
  postMessage(message: unknown): void {
    void Promise.resolve().then(() => this.scope.onmessage?.({ data: message }));
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** An abort controller without the DOM: a signal with events, and a way to fire it. */
function controller(): { signal: AbortSignalWithEvents; abort(): void } {
  const listeners = new Set<() => void>();
  const state = { aborted: false };
  const signal: AbortSignalWithEvents = {
    get aborted() {
      return state.aborted;
    },
    addEventListener: (_type, fn) => void listeners.add(fn),
    removeEventListener: (_type, fn) => void listeners.delete(fn),
  };
  return {
    signal,
    abort: () => {
      state.aborted = true;
      for (const fn of [...listeners]) fn();
    },
  };
}

const rejection = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as Error,
  );

describe('layout worker (FR-LAY-007)', () => {
  it('FR-LAY-007: a job goes to the worker and its result is the one layoutSync gives', async () => {
    const host = createLayoutHost(() => new LoopbackWorker());
    const result = await host.run(job({ options: { direction: 'right' }, seed: 5, fontHash: 'f' }));
    const direct = layoutSync({ input, algorithm: layeredLayout, options: { direction: 'right' }, seed: 5, fontHash: 'f' });
    expect(result).toEqual(direct);
    expect(result.ok && result.value.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it('FR-LAY-007: aborting a running job rejects with AbortError, ends its worker, and the next job runs on a fresh one', async () => {
    const workers: ManualWorker[] = [];
    const host = createLayoutHost(() => {
      const w = new ManualWorker();
      workers.push(w);
      return w;
    });
    const c = controller();
    const pending = rejection(host.run(job(), c.signal));
    expect(workers).toHaveLength(1);
    expect(workers[0]?.sent).toHaveLength(1);
    // what the worker's message handler was when the abort came: a real worker may still deliver an already queued message through it
    const lateHandler = workers[0]?.onmessage;
    c.abort();
    const error = await pending;
    expect(error?.name).toBe('AbortError');
    expect(workers[0]?.terminated).toBe(true);
    // a reply that arrives after the abort is ignored; the next job gets another worker
    const second = host.run(job({ revision: 2 }));
    expect(workers).toHaveLength(2);
    lateHandler?.({
      data: { type: 'done', id: workers[0]?.sent[0]?.id, output: { boxes: {}, metrics: { overlaps: 0, crossings: 0, bends: 0, ms: 0 }, fingerprint: 'late' } },
    });
    const sent = workers[1]?.sent[0] as LayoutJobMessage;
    workers[1]?.say({ type: 'done', id: sent.id, output: { boxes: {}, metrics: { overlaps: 0, crossings: 0, bends: 0, ms: 0 }, fingerprint: 'x' } });
    expect(await second).toMatchObject({ ok: true, value: { fingerprint: 'x' } });
  });

  it('FR-LAY-007: a reply of an older job or with the wrong id never settles a newer job of the same scope', async () => {
    const workers: ManualWorker[] = [];
    const host = createLayoutHost(() => {
      const w = new ManualWorker();
      workers.push(w);
      return w;
    });
    const first = rejection(host.run(job({ revision: 1 })));
    const oldHandler = workers[0]?.onmessage;
    const second = host.run(job({ revision: 2 }));
    await first;
    const done = (id: number | undefined, fingerprint: string) => ({
      type: 'done',
      id,
      output: { boxes: {}, metrics: { overlaps: 0, crossings: 0, bends: 0, ms: 0 }, fingerprint },
    });
    // the old job's worker was ended, yet a queued reply still reaches its old handler: the host must not settle the new job with it
    oldHandler?.({ data: done(workers[0]?.sent[0]?.id, 'old') });
    // a reply with another id, junk, or a reply of an unknown shape on the live worker is ignored too
    const live = workers[1] as ManualWorker;
    const liveId = live.sent[0]?.id;
    for (const junk of [
      done((liveId ?? 0) + 100, 'wrong id'),
      null,
      'text',
      { type: 'done', id: liveId },
      { type: 'error', id: liveId },
      { type: 'progress', id: liveId },
    ])
      live.say(junk);
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    live.say(done(liveId, 'new'));
    expect(await second).toMatchObject({ ok: true, value: { fingerprint: 'new' } });
  });

  it('FR-LAY-007: a newer revision of a scope supersedes the running one, and an older revision is refused at once', async () => {
    const workers: ManualWorker[] = [];
    const host = createLayoutHost(() => {
      const w = new ManualWorker();
      workers.push(w);
      return w;
    });
    const first = rejection(host.run(job({ revision: 1 })));
    const second = host.run(job({ revision: 2 }));
    const superseded = await first;
    expect(superseded?.name).toBe('AbortError');
    expect(superseded?.message).toBe('superseded by revision 2');
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.terminated).toBe(false);
    // revision 1 asked again, after 2 was seen: it never reaches a worker
    const stale = await rejection(host.run(job({ revision: 1 })));
    expect(stale?.message).toBe('superseded by revision 2');
    expect(workers).toHaveLength(2);
    const sent = workers[1]?.sent[0] as LayoutJobMessage;
    workers[1]?.say({ type: 'error', id: sent.id, error: { code: 'LAYOUT_INPUT_INVALID', message: 'no' } });
    expect(await second).toEqual({ ok: false, error: { code: 'LAYOUT_INPUT_INVALID', message: 'no' } });
  });

  it('FR-LAY-007: jobs of different scopes run side by side, and dispose ends every worker and rejects what is in flight', async () => {
    const workers: ManualWorker[] = [];
    const host = createLayoutHost(() => {
      const w = new ManualWorker();
      workers.push(w);
      return w;
    });
    const a = rejection(host.run(job({ scope: 'a' })));
    const b = rejection(host.run(job({ scope: 'b' })));
    expect(workers).toHaveLength(2);
    expect(workers.every((w) => !w.terminated)).toBe(true);
    host.dispose();
    expect((await a)?.name).toBe('AbortError');
    expect((await b)?.name).toBe('AbortError');
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it('FR-LAY-007: an aborted signal rejects before any worker starts, a worker error is a LAYOUT_FAILED result, and an unknown algorithm is LAYOUT_ALGORITHM_UNKNOWN', async () => {
    let spawned = 0;
    const host = createLayoutHost(() => {
      spawned += 1;
      return new LoopbackWorker();
    });
    const c = controller();
    c.abort();
    expect((await rejection(host.run(job(), c.signal)))?.name).toBe('AbortError');
    expect(spawned).toBe(0);
    const unknown = await host.run(job({ algorithm: 'tree', revision: 3 }));
    expect(unknown).toMatchObject({ ok: false, error: { code: 'LAYOUT_ALGORITHM_UNKNOWN' } });
    const crashing = new ManualWorker();
    const crashHost = createLayoutHost(() => crashing);
    const pending = crashHost.run(job());
    crashing.onerror?.(new Error('out of memory'));
    expect(await pending).toEqual({ ok: false, error: { code: 'LAYOUT_FAILED', message: 'out of memory' } });
    expect(crashing.terminated).toBe(true);
    // a browser ErrorEvent is not an Error: its message is still reported
    const browser = new ManualWorker();
    const eventHost = createLayoutHost(() => browser);
    const crashed = eventHost.run(job());
    browser.onerror?.({ message: 'Uncaught RangeError', filename: 'layout.js' });
    expect(await crashed).toEqual({ ok: false, error: { code: 'LAYOUT_FAILED', message: 'Uncaught RangeError' } });
  });

  it('FR-LAY-007: a worker that cannot be started, cannot be sent the job, sends an unreadable message or cannot be ended still settles the job', async () => {
    const nospawn = createLayoutHost(() => {
      throw new Error('too many workers');
    });
    expect(await nospawn.run(job())).toEqual({ ok: false, error: { code: 'LAYOUT_FAILED', message: 'no layout worker could be started: too many workers' } });
    const unsendable = new ManualWorker();
    unsendable.failToSend = new Error('DataCloneError');
    const c = controller();
    const sendHost = createLayoutHost(() => unsendable);
    expect(await sendHost.run(job(), c.signal)).toEqual({
      ok: false,
      error: { code: 'LAYOUT_FAILED', message: 'the layout job could not be sent: DataCloneError' },
    });
    expect(unsendable.terminated).toBe(true);
    // the abort listener was removed: aborting later changes nothing
    c.abort();
    const garbled = new ManualWorker();
    const garbledHost = createLayoutHost(() => garbled);
    const pending = garbledHost.run(job());
    garbled.onmessageerror?.({});
    expect(await pending).toMatchObject({ ok: false, error: { code: 'LAYOUT_FAILED' } });
    const stubborn = new ManualWorker();
    stubborn.terminate = () => {
      throw new Error('already gone');
    };
    const stubbornHost = createLayoutHost(() => stubborn);
    const cc = controller();
    const aborted = rejection(stubbornHost.run(job(), cc.signal));
    cc.abort();
    expect((await aborted)?.name).toBe('AbortError');
  });

  it('FR-LAY-007: serveLayoutWorker answers each job with done or error and ignores cancel and messages of other protocols', () => {
    const sent: unknown[] = [];
    const scope: WorkerScopeLike = { onmessage: null, postMessage: (m) => void sent.push(m) };
    serveLayoutWorker(scope, lookup);
    const message: LayoutJobMessage = { type: 'layout', id: 7, revision: 1, algorithm: 'stack', input, seed: 0, fontHash: '', post: ['pins'] };
    scope.onmessage?.({ data: message });
    scope.onmessage?.({ data: { type: 'cancel', id: 7 } });
    scope.onmessage?.({ data: 'hello' });
    scope.onmessage?.({ data: null });
    scope.onmessage?.({ data: { ...message, id: 8, options: { gap: -1 } } });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: 'done', id: 7, output: { fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/) } });
    expect(sent[1]).toMatchObject({ type: 'error', id: 8, error: { code: 'LAYOUT_OPTIONS_INVALID' } });
  });
});
