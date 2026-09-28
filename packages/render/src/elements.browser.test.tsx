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
