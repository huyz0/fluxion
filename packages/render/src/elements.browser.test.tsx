import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRenderRegistries, type ElementViewProps, type RenderRegistries } from './registries.js';
import { ScreenView } from './screen-view.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A screen with three rects; `patch` rewrites records of the built document. */
function setup(patch: (records: Record<string, unknown>, ids: { rects: RecordId[] }) => void = () => {}) {
  const b = documentBuilder({ seed: 413 });
  const screenId = b.screen({ size: { w: 400, h: 300 } });
  const rects = [
    b.rect(screenId, { x: 10, y: 20, w: 100, h: 50 }),
    b.rect(screenId, { x: 150, y: 20, w: 60, h: 60 }),
    b.rect(screenId, { x: 250, y: 20, w: 40, h: 40 }),
  ];
  const file = b.build();
  const records: Record<string, unknown> = structuredClone(file.records) as Record<string, unknown>;
  patch(records, { rects });
  return { file: { ...file, records } as DocumentFile, screenId, rects };
}

async function show(file: DocumentFile, screenId: RecordId, registries?: RenderRegistries) {
  const core = createCore(file);
  await act(async () =>
    root.render(
      <ScreenView
        store={core.store}
        screenId={screenId}
        mode="present"
        view={{ kind: 'fit', box: { w: 400, h: 300 } }}
        {...(registries ? { registries } : {})}
      />,
    ),
  );
  return core;
}

const GROUP = 'G0000000000group';
const wrappers = () => [...host.querySelectorAll<HTMLElement>('.fx-el')];
const Marker = (props: ElementViewProps) => <i data-view={props.element.kind}>{props.children}</i>;

describe('element views (FR-EXT-001, FR-DOC-005)', () => {
  it('FR-DOC-005: an unregistered kind renders a labelled placeholder and keeps the record', async () => {
    const { file, screenId, rects } = setup((records, { rects: [first] }) => {
      const el = records[first as string] as Record<string, unknown>;
      records[first as string] = { ...el, kind: 'acme:gauge', props: { value: 3 } };
    });
    const before = structuredClone(file.records[rects[0] as RecordId]);
    const core = await show(file, screenId);
    const wrapper = host.querySelector<HTMLElement>(`.fx-el[data-el-id="${rects[0]}"]`);
    expect(wrapper?.dataset['kind']).toBe('acme:gauge');
    const placeholder = wrapper?.querySelector('.fx-placeholder');
    expect(placeholder?.getAttribute('role')).toBe('img');
    expect(placeholder?.getAttribute('aria-label')).toBe('Unsupported element: acme:gauge');
    expect(placeholder?.textContent).toBe('acme:gauge');
    // placed at the element's box
    expect(wrapper?.style.left).toBe('10px');
    expect(wrapper?.style.width).toBe('100px');
    // rendering read the record and changed nothing
    expect(core.store.get(rects[0] as RecordId)).toEqual(before);
  });

  it('FR-EXT-001: a view registered for a kind draws it, and registering one re-renders', async () => {
    const { file, screenId } = setup();
    const registries = createRenderRegistries();
    await show(file, screenId, registries);
    expect(host.querySelectorAll('.fx-placeholder')).toHaveLength(3);
    await act(async () => {
      registries.elementViews.register('shape', { Component: Marker }, 'test');
    });
    expect(host.querySelectorAll('.fx-placeholder')).toHaveLength(0);
    expect(host.querySelectorAll('[data-view="shape"]')).toHaveLength(3);
    // a second source cannot take the kind over
    expect(registries.elementViews.register('shape', { Component: () => null }, 'other').ok).toBe(false);
  });

  it('FR-DOC-010: wrappers follow fractional-index order; groups nest their members; hidden elements are not drawn', async () => {
    const { file, screenId, rects } = setup((records, { rects: [a, b, c] }) => {
      const at = (id: RecordId | undefined) => records[id as string] as Record<string, unknown>;
      records[a as string] = { ...at(a), index: 'a5' };
      records[b as string] = { ...at(b), index: 'a1' };
      const { type, screenId: on } = at(a);
      records[GROUP] = { id: GROUP, type, screenId: on, kind: 'group', index: 'a3', transform: { x: 0, y: 0, w: 400, h: 300 } };
      records[c as string] = { ...at(c), parentId: GROUP, index: 'a0' };
    });
    const hiddenFile = structuredClone(file);
    await show(file, screenId);
    const [a, b, c] = rects as [RecordId, RecordId, RecordId];
    const top = [...host.querySelectorAll<HTMLElement>('.fx-content > .fx-el')].map((w) => w.dataset['elId']);
    expect(top).toEqual([b, GROUP, a]);
    expect(host.querySelector(`.fx-el[data-el-id="${GROUP}"] .fx-el[data-el-id="${c}"]`)).not.toBeNull();
    (hiddenFile.records[b] as { hidden?: boolean }).hidden = true;
    await show(hiddenFile, screenId);
    expect(wrappers().map((w) => w.dataset['elId'])).not.toContain(b);
  });

  it('FR-PRS-003: the elements a build hides are not drawn, with their members, and the others are', async () => {
    const { file, screenId, rects } = setup((records, { rects: [a, , c] }) => {
      const at = (id: RecordId | undefined) => records[id as string] as { type: string; screenId: string };
      const { type, screenId: on } = at(a);
      records[GROUP] = { id: GROUP, type, screenId: on, kind: 'group', index: 'a3', transform: { x: 0, y: 0, w: 400, h: 300 } };
      records[c as string] = { ...at(c), parentId: GROUP, index: 'a0' };
    });
    const [a, b, c] = rects as [RecordId, RecordId, RecordId];
    const core = createCore(file);
    const drawn = async (hidden?: ReadonlySet<RecordId>) => {
      await act(async () =>
        root.render(
          <ScreenView store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 300 } }} {...(hidden ? { hidden } : {})} />,
        ),
      );
      return wrappers().map((w) => w.dataset['elId']);
    };
    expect(await drawn()).toEqual(expect.arrayContaining([a, b, c, GROUP]));
    // one element hidden, the rest stay
    const some = await drawn(new Set([b]));
    expect(some).not.toContain(b);
    expect(some).toEqual(expect.arrayContaining([a, c, GROUP]));
    // a member hidden inside a visible group
    const member = await drawn(new Set([c]));
    expect(member).not.toContain(c);
    expect(member).toContain(GROUP);
    // a group hidden takes its members with it
    const group = await drawn(new Set<RecordId>([GROUP as RecordId]));
    expect(group).not.toContain(GROUP);
    expect(group).not.toContain(c);
    expect(group).toEqual(expect.arrayContaining([a, b]));
  });

  it('NFR-PERF-001: a move redraws the wrapper and members container only; any other change redraws the view', async () => {
    const { file, screenId, rects } = setup((records, { rects: [a, b] }) => {
      const { type, screenId: on } = records[a as string] as Record<string, unknown>;
      records[GROUP] = { id: GROUP, type, screenId: on, kind: 'group', index: 'a9', transform: { x: 100, y: 50, w: 200, h: 120 } };
      records[b as string] = { ...(records[b as string] as object), parentId: GROUP, transform: { x: 130, y: 80, w: 40, h: 20 } };
    });
    const drawn = new Map<string, number>();
    const Counting = (props: ElementViewProps) => {
      drawn.set(props.element.id, (drawn.get(props.element.id) ?? 0) + 1);
      return <i data-view={props.element.kind}>{props.children}</i>;
    };
    const registries = createRenderRegistries();
    registries.elementViews.register('shape', { Component: Counting }, 'test');
    registries.elementViews.register('group', { Component: Counting }, 'test');
    const core = await show(file, screenId, registries);
    const [first, member] = rects as [RecordId, RecordId];
    const count = () => [first, GROUP, member].map((id) => drawn.get(id) ?? 0);
    const [b0, b1, b2] = count() as [number, number, number];
    const before = [b0, b1, b2];
    const patch = (id: RecordId, transform: object) => act(() => void core.store.transact('move', (tx) => tx.patch(id, { transform })));
    // moved: placed anew, not drawn again
    patch(first, { x: 30, y: 40, w: 100, h: 50 });
    expect(count()).toEqual(before);
    expect(host.querySelector<HTMLElement>(`.fx-el[data-el-id="${first}"]`)?.style.left).toBe('30px');
    // a moved group's members container follows it: its member stays at its own stored box
    patch(GROUP as RecordId, { x: 60, y: 10, w: 200, h: 120 });
    expect(count()).toEqual(before);
    const screen = host.querySelector('.fx-screen')?.getBoundingClientRect();
    const box = host.querySelector(`.fx-el[data-el-id="${member}"]`)?.getBoundingClientRect();
    expect([(box?.left ?? 0) - (screen?.left ?? 0), (box?.top ?? 0) - (screen?.top ?? 0)].map(Math.round)).toEqual([130, 80]);
    // resized, turned, or a field besides the box changed: drawn again
    patch(first, { x: 30, y: 40, w: 120, h: 50 });
    patch(first, { x: 30, y: 40, w: 120, h: 50, rot: 10 });
    act(() => void core.store.transact('name', (tx) => tx.patch(first, { name: 'first' })));
    expect(count()).toEqual([b0 + 3, b1, b2]);
    // a registry the views read changing draws them all again
    await act(async () => {
      registries.shapeDefs.register('acme:x', { id: 'acme:x', outline: { path: 'M 0 0 Z' }, defaultSize: { w: 1, h: 1 } }, 'test');
    });
    expect(count()).toEqual([b0 + 4, b1 + 1, b2 + 1]);
  });

  it('FR-DOC-005: a member of an offset, rotated, flipped group is drawn at its own stored box', async () => {
    const { file, screenId, rects } = setup((records, { rects: [a, b] }) => {
      const { type, screenId: on } = records[a as string] as Record<string, unknown>;
      records[GROUP] = { id: GROUP, type, screenId: on, kind: 'group', index: 'a9', transform: { x: 100, y: 50, w: 200, h: 120, rot: 30, flipX: true } };
      records[b as string] = { ...(records[b as string] as object), parentId: GROUP, transform: { x: 130, y: 80, w: 40, h: 20 } };
    });
    await show(file, screenId);
    const screen = host.querySelector('.fx-screen')?.getBoundingClientRect();
    const member = host.querySelector(`.fx-el[data-el-id="${rects[1]}"]`)?.getBoundingClientRect();
    expect((member?.left ?? 0) - (screen?.left ?? 0)).toBeCloseTo(130, 0);
    expect((member?.top ?? 0) - (screen?.top ?? 0)).toBeCloseTo(80, 0);
    expect(member?.width).toBeCloseTo(40, 0);
    expect(member?.height).toBeCloseTo(20, 0);
    // the members stay in the accessibility tree, outside the placeholder's img role
    expect(host.querySelector(`.fx-el[data-el-id="${GROUP}"] [role="img"] .fx-el`)).toBeNull();
  });
});
