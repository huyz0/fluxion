import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createSession, DEFAULT_CAMERA } from './session.js';
import { readViewMeta, restoreView, snapshotView, type ViewMeta, withViewMeta } from './view-meta.js';

const id = (s: string) => s as RecordId;
const camera = { x: 5, y: 6, z: 2 };

describe('the view undo and redo bring back (FR-EDT-006, ADR-0014)', () => {
  it('FR-EDT-006: a snapshot holds the shown screen, the selection and the camera', () => {
    const session = createSession('doc');
    session.selection.set([id('a'), id('b')]);
    session.camera.set(camera);
    expect(snapshotView(session, id('s2'))).toEqual({ screen: 's2', selection: ['a', 'b'], camera });
    expect(snapshotView(session, undefined).screen).toBeUndefined();
  });

  it('FR-EDT-006: a view in a history entry is read defensively: anything else is no view', () => {
    const view = { screen: 's1', selection: ['a'], camera };
    expect(readViewMeta(view)).toEqual(view);
    expect(readViewMeta({ ...view, screen: undefined })).toEqual({ ...view, screen: undefined });
    // the zoom is held to the limits
    expect(readViewMeta({ ...view, camera: { x: 0, y: 0, z: 1e9 } })?.camera.z).toBe(32);
    for (const bad of [
      undefined,
      null,
      'x',
      5,
      {},
      { ...view, selection: 'a' },
      { ...view, selection: [1] },
      { ...view, selection: ['a', 1] },
      { ...view, screen: 5 },
      { ...view, camera: undefined },
      { ...view, camera: null },
      { ...view, camera: { x: '0', y: 0, z: 1 } },
      { ...view, camera: { x: 0, y: '0', z: 1 } },
      { ...view, camera: { x: 0, y: 0, z: '1' } },
      { ...view, camera: { x: 0, y: Number.NaN, z: 1 } },
      { ...view, camera: { x: 0, y: 0, z: Number.POSITIVE_INFINITY } },
      { ...view, camera: { x: 0, y: 0 } },
    ])
      expect(readViewMeta(bad)).toBeUndefined();
  });

  it('FR-EDT-006: restoring an edit made on another screen shows that screen with its camera and selection', () => {
    const session = createSession('doc');
    session.camera.set(DEFAULT_CAMERA);
    const meta: ViewMeta = { screen: id('s2'), selection: [id('a'), id('gone')], camera };
    const exists = (r: RecordId) => r !== 'gone';
    restoreView(session, meta, id('s1'), exists);
    expect([session.screen.get(), session.camera.get(), session.selection.get()]).toEqual(['s2', camera, ['a']]);
  });

  it('FR-EDT-006: on the same screen only the selection returns; the camera stays where the user put it', () => {
    const session = createSession('doc');
    session.camera.set({ x: 1, y: 1, z: 4 });
    restoreView(session, { screen: id('s1'), selection: [id('a')], camera }, id('s1'), () => true);
    expect([session.screen.get(), session.camera.get(), session.selection.get()]).toEqual([undefined, { x: 1, y: 1, z: 4 }, ['a']]);
    // a screen that is gone is not navigated to; nor is a view without one
    restoreView(session, { screen: id('s9'), selection: [], camera }, id('s1'), (r) => r !== 's9');
    restoreView(session, { screen: undefined, selection: [], camera }, id('s1'), () => true);
    expect([session.screen.get(), session.camera.get(), session.selection.get()]).toEqual([undefined, { x: 1, y: 1, z: 4 }, []]);
  });

  it('FR-EDT-006: every write carries the view before it and, once the tool is done, the view after; a caller`s own meta is kept', async () => {
    const b = documentBuilder({ seed: 77 });
    const screen = b.screen({ size: { w: 100, h: 100 } });
    const rect = b.rect(screen, { x: 0, y: 0, w: 10, h: 10 });
    const core = createCore(b.build());
    const session = createSession('doc');
    session.selection.set([rect]);
    session.camera.set(camera);
    const execute = withViewMeta(core.execute, session, () => screen);
    expect(execute('element.update', { id: rect, fields: { name: 'one' } }).ok).toBe(true);
    // the tool selects something else right after the write
    session.selection.set([]);
    session.camera.set({ x: 0, y: 0, z: 1 });
    await Promise.resolve();
    // undo brings back the view before; redo the view after
    const undone = core.store.history.undo();
    const redone = core.store.history.redo();
    expect([undone.ok && undone.value, redone.ok && redone.value]).toEqual([
      { screen, selection: [rect], camera },
      { screen, selection: [], camera: { x: 0, y: 0, z: 1 } },
    ]);
    // the caller's own meta wins, and a merged gesture keeps the first view before
    core.store.history.seal();
    execute('element.update', { id: rect, fields: { name: 'two' } }, { metaBefore: 'mine', metaAfter: 'also mine' });
    expect(core.store.history.undo()).toEqual({ ok: true, value: 'mine' });
    expect(core.store.history.redo()).toEqual({ ok: true, value: 'also mine' });
    core.store.history.seal();
    session.selection.set([rect]);
    execute('element.update', { id: rect, fields: { name: 'g1' } }, { mergeKey: 'gesture:1' });
    session.selection.set([]);
    execute('element.update', { id: rect, fields: { name: 'g2' } }, { mergeKey: 'gesture:1' });
    await Promise.resolve();
    expect(core.store.history.undo()).toMatchObject({ ok: true, value: { selection: [rect] } });
  });
});
