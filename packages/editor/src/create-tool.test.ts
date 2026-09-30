import { createCore } from '@fluxion/core';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { createElement, dragBox, frameMaker, frontIndex, imageAssets, imageMaker, shapeMaker, textMaker } from './create-tool.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry, type KeyInfo } from './tools.js';

const at = (phase: PointerPhase, x: number, y: number, o: Partial<PointerInfo> = {}): PointerInfo => ({
  phase,
  pointerId: 1,
  pointerType: 'mouse',
  screen: { x, y },
  page: { x, y },
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  shift: false,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
  ...o,
});
const key = (k: string): KeyInfo => ({ key: k, shift: false, alt: false, mod: false });

/** A screen with one rect, the built-in tools over a real core, on that screen. */
function setup(onScreen = true) {
  const b = documentBuilder({ seed: 170 });
  const screen = b.screen();
  const rect = b.rect(screen, { x: 0, y: 0, w: 10, h: 10 });
  const core = createCore(b.build());
  const session = createSession('doc');
  let n = 0;
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const deps = {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => `newnewnewnewn${String(++n).padStart(3, '0')}` as RecordId,
    screen: onScreen ? screen : undefined,
  };
  const tools = createToolDispatcher(registry, { ...deps, hitTest: () => undefined, elementsIn: () => [], allElements: () => [] });
  const added = () => core.store.ids().filter((id) => id.startsWith('newnew'));
  const record = (id: RecordId | undefined) => core.store.get(id as RecordId) as (AnyRecord & { transform: object; index: string; kind: string }) | undefined;
  return { core, screen, rect, session, tools, deps, added, record };
}

describe('creation tools (FR-EDT-003)', () => {
  it('FR-EDT-003: a click places the default size centred on it; a drag its box; shift keeps it square', () => {
    const size = { w: 160, h: 100 };
    const drag = { z: 1, shift: false };
    expect(dragBox({ x: 100, y: 100 }, { x: 102, y: 101 }, size, drag)).toEqual({ x: 20, y: 50, w: 160, h: 100 });
    expect(dragBox({ x: 100, y: 100 }, { x: 150, y: 130 }, size, drag)).toEqual({ x: 100, y: 100, w: 50, h: 30 });
    // dragged up and left: the box still starts at its top-left corner
    expect(dragBox({ x: 100, y: 100 }, { x: 50, y: 70 }, size, drag)).toEqual({ x: 50, y: 70, w: 50, h: 30 });
    expect(dragBox({ x: 100, y: 100 }, { x: 150, y: 130 }, size, { z: 1, shift: true })).toEqual({ x: 100, y: 100, w: 50, h: 50 });
    expect(dragBox({ x: 100, y: 100 }, { x: 70, y: 40 }, size, { z: 1, shift: true })).toEqual({ x: 40, y: 40, w: 60, h: 60 });
    // the click threshold is in canvas px: 3 page units at 200 % is a drag, at 100 % a click
    // an axis not dragged takes the default size: nothing is placed flat
    expect(dragBox({ x: 0, y: 0 }, { x: 3, y: 0 }, size, { z: 2, shift: false })).toEqual({ x: 0, y: 0, w: 3, h: 100 });
    expect(dragBox({ x: 0, y: 0 }, { x: 100, y: 1 }, size, drag)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(dragBox({ x: 0, y: 0 }, { x: -1, y: -100 }, size, drag)).toEqual({ x: 0, y: -100, w: 160, h: 100 });
    // with shift the square grows backwards along both axes the pointer went back on
    expect(dragBox({ x: 0, y: 0 }, { x: 0, y: -100 }, size, { z: 1, shift: true })).toEqual({ x: 0, y: -100, w: 100, h: 100 });
    expect(dragBox({ x: 0, y: 0 }, { x: -1, y: -100 }, size, { z: 1, shift: true })).toEqual({ x: -100, y: -100, w: 100, h: 100 });
    // along the axis, the threshold is in canvas px too: 3 page units at 200 % count
    expect(dragBox({ x: 0, y: 0 }, { x: 100, y: 3 }, size, { z: 2, shift: false })).toEqual({ x: 0, y: 0, w: 100, h: 3 });
    expect(dragBox({ x: 0, y: 0 }, { x: 3, y: 0 }, size, drag).w).toBe(160);
    expect(dragBox({ x: 0, y: 0 }, { x: 4, y: 0 }, size, drag).w).toBe(4);
  });

  it('FR-EDT-003: each tool makes its kind of element in front of the screen`s root elements', () => {
    const { core, screen, rect } = setup();
    const place = { id: 'n' as RecordId, screenId: screen, index: 'b0', transform: { x: 1, y: 2, w: 3, h: 4 } };
    const common = { id: 'n', type: 'element', screenId: screen, index: 'b0', transform: { x: 1, y: 2, w: 3, h: 4 } };
    expect(shapeMaker()(place)).toEqual({ ...common, kind: 'shape', defId: 'basic:rect' });
    expect(shapeMaker('basic:ellipse')(place)).toEqual({ ...common, kind: 'shape', defId: 'basic:ellipse' });
    expect(textMaker(place)).toEqual({
      ...common,
      kind: 'shape',
      defId: 'basic:text-box',
      text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] },
    });
    expect(frameMaker(place)).toEqual({ ...common, kind: 'frame' });
    expect(imageMaker('asset' as RecordId)(place)).toEqual({ ...common, kind: 'image', assetId: 'asset' });
    const rectIndex = (core.store.get(rect) as { index: string }).index;
    expect(String(frontIndex(core.store, screen)) > rectIndex).toBe(true);
  });

  it('FR-EDT-003: in front of the last root element, not of a member of a group', () => {
    const b = documentBuilder({ seed: 171 });
    const screen = b.screen();
    b.rect(screen, { x: 0, y: 0, w: 10, h: 10 });
    const core = createCore(b.build());
    const ids = core.store.ids();
    const root = ids.find((id) => core.store.get(id)?.type === 'element') as RecordId;
    core.store.transact('index', (tx) => tx.patch(root, { index: 'a5' }));
    // a member indexed after every root element does not count
    const group = 'GroupGroupGroup1' as RecordId;
    core.store.transact('group', (tx) => {
      tx.put({ id: group, type: 'element', screenId: screen, kind: 'group', index: 'a1', transform: { x: 0, y: 0, w: 1, h: 1 } } as AnyRecord);
      tx.put({
        id: 'MemberMemberMem1',
        type: 'element',
        screenId: screen,
        parentId: group,
        kind: 'frame',
        index: 'a9',
        transform: { x: 0, y: 0, w: 1, h: 1 },
      } as AnyRecord);
    });
    expect(frontIndex(core.store, screen)).toBe('a6');
    // an empty screen starts the order; a malformed index gives none
    const empty = documentBuilder({ seed: 172 });
    const bare = empty.screen();
    expect(frontIndex(createCore(empty.build()).store, bare)).toBe('a0');
    const broken = { members: () => ['x'], get: () => ({ index: '!!' }) } as unknown as Parameters<typeof frontIndex>[0];
    expect(frontIndex(broken, bare)).toBeUndefined();
  });

  it('FR-EDT-003: the creation tools are registered with their names and keys', () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    const creation = registry
      .list()
      .map(([, t]) => [t.id, t.title, t.shortcut])
      .filter(([id]) => !['select', 'hand'].includes(id as string));
    expect(creation).toEqual([
      ['connector', 'Connector', 'c'],
      ['frame', 'Frame', 'f'],
      ['freehand', 'Freehand', 'd'],
      ['image', 'Image', 'i'],
      ['pen', 'Pen', 'p'],
      ['shape', 'Shape', 'r'],
      ['text', 'Text', 't'],
    ]);
  });

  it('FR-EDT-003: a click with the shape tool adds one rect, selected, in one undo step, and select is back', () => {
    const { core, session, tools, added, record } = setup();
    tools.key(key('r'));
    expect(tools.current).toBe('shape.idle');
    tools.pointer(at('down', 300, 200));
    expect(tools.current).toBe('shape.sizing');
    tools.pointer(at('up', 300, 200));
    const [id] = added();
    expect(added()).toHaveLength(1);
    expect(record(id)).toMatchObject({ kind: 'shape', defId: 'basic:rect', transform: { x: 220, y: 150, w: 160, h: 100 } });
    expect([session.selection.get(), session.tool.get(), tools.current]).toEqual([[id], 'select', 'select.idle']);
    expect(core.store.history.undoDepth).toBe(1);
    core.store.history.undo();
    expect(added()).toEqual([]);
  });

  it('FR-EDT-003: a drag draws the draft and adds its box; Esc and other buttons add nothing', () => {
    const { session, tools, added, record } = setup();
    for (const [k, kind] of [
      ['t', 'shape'],
      ['f', 'frame'],
      ['r', 'shape'],
    ] as const) {
      tools.key(key(k));
      tools.pointer(at('down', 10, 20));
      tools.pointer(at('move', 60, 50));
      expect(session.draft.get()).toEqual({ x: 10, y: 20, w: 50, h: 30 });
      tools.pointer(at('up', 110, 80));
      expect(session.draft.get()).toBeUndefined();
      expect(record(added().at(-1))).toMatchObject({ kind, transform: { x: 10, y: 20, w: 100, h: 60 } });
    }
    // each tool its own element: T a text box reading "Text", R a rect
    const [text, , rect] = added().map((id) => record(id) as unknown as { defId?: string; text?: unknown });
    expect([text?.defId, rect?.defId, rect?.text]).toEqual(['basic:text-box', 'basic:rect', undefined]);
    expect(JSON.stringify(text?.text)).toContain('"text":"Text"');
    expect(added()).toHaveLength(3);
    tools.key(key('r'));
    tools.pointer(at('down', 10, 20, { button: 2 }));
    expect(tools.current).toBe('shape.idle');
    tools.pointer(at('down', 10, 20));
    tools.pointer(at('move', 60, 50));
    tools.key(key('Escape'));
    expect([tools.current, session.draft.get()]).toEqual(['shape.idle', undefined]);
    tools.pointer(at('up', 60, 50));
    expect(added()).toHaveLength(3);
  });

  it('FR-EDT-003: the image tool leaves its box to the picker, adding nothing itself', () => {
    const { session, tools, added } = setup();
    tools.key(key('i'));
    tools.pointer(at('down', 100, 100));
    tools.pointer(at('up', 100, 100));
    expect(session.imagePick.get()).toEqual({ x: -20, y: 20, w: 240, h: 160 });
    expect([added(), tools.current]).toEqual([[], 'image.idle']);
  });

  it('FR-EDT-003: without a screen, or when the command refuses, nothing is added or selected', () => {
    const off = setup(false);
    expect(createElement(off.deps, { x: 0, y: 0, w: 1, h: 1 }, frameMaker)).toBeUndefined();
    const { deps, session, added } = setup();
    session.tool.set('frame');
    // an element the schema refuses (a shape without its definition)
    expect(createElement(deps, { x: 0, y: 0, w: 1, h: 1 }, (p) => ({ ...frameMaker(p), kind: 'shape' }) as AnyRecord)).toBeUndefined();
    expect([added(), session.selection.get(), session.tool.get()]).toEqual([[], [], 'frame']);
  });

  it('FR-EDT-003: the picker offers the document`s image assets by name', () => {
    const { core } = setup();
    const asset = (id: string, name: string, mime: string) => ({ id, type: 'asset', hash: 'a'.repeat(64), mime, size: 1, name }) as unknown as AnyRecord;
    core.store.transact('assets', (tx) => {
      tx.put(asset('AssetBAssetBAss1', 'b.png', 'image/png'));
      tx.put(asset('AssetAAssetAAss1', 'a.svg', 'image/svg+xml'));
      tx.put(asset('AssetZAssetZAss1', 'a.svg', 'image/webp'));
      tx.put(asset('FontFontFontFon1', 'f.woff2', 'font/woff2'));
    });
    expect(imageAssets(core.store)).toEqual([
      { id: 'AssetAAssetAAss1', name: 'a.svg' },
      { id: 'AssetZAssetZAss1', name: 'a.svg' },
      { id: 'AssetBAssetBAss1', name: 'b.png' },
    ]);
  });
});
