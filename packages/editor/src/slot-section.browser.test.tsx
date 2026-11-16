// FR-SHP-007, FR-LIB-009: an icon slot filled from the inspector with a definition the host's catalog has but has not
// loaded (a first-party pack's) loads it first, so the slot draws it and the save embeds it (M19.38); a registered
// definition is filled straight away, and a load that fails still fills the slot, which the Problems tab then reports.
import { createCore, type ShapeDef } from '@fluxion/core';
import type { DocumentFile, RecordId, ShapeElement } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IconSlotsSection } from './slot-section.js';

const CARD: ShapeDef = {
  id: 'test:card',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  iconSlots: [{ name: 'icon', x: 0.06, y: 0.06, w: 0.2, h: 0.28 }],
  defaultSize: { w: 200, h: 100 },
};
const ICON: ShapeDef = { id: 'pack:icon', outline: { path: 'M 0 0 L {w} {h} Z' }, defaultSize: { w: 24, h: 24 } };

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

function mount(ensureDef?: (defId: string) => Promise<boolean>) {
  const b = documentBuilder({ seed: 1938 });
  const screen = b.screen();
  const id = b.rect(screen, { x: 0, y: 0, w: 200, h: 100 }) as RecordId;
  const file = b.build();
  const records = { ...file.records, [id]: { ...(file.records[id] as object), defId: CARD.id } } as DocumentFile['records'];
  const core = createCore({ ...file, records });
  const registered = new Map<string, ShapeDef>([[CARD.id, CARD]]);
  const defs = { get: (k: string) => registered.get(k) };
  act(() => root.render(<IconSlotsSection store={core.store} id={id} execute={core.execute} shapeDefs={defs} ensureDef={ensureDef} />));
  const commit = async (value: string) => {
    // the row is drawn again once filled, so the input is looked up each time
    const input = host.querySelector('input[aria-label="Icon shape for icon"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.value = value;
      input.blur();
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  return { core, id, registered, commit, icons: () => (core.store.get(id) as ShapeElement).icons };
}

describe('icon slots load what they name (FR-SHP-007, FR-LIB-009)', () => {
  it('FR-LIB-009: a slot naming a catalog definition loads and registers it before the slot is filled', async () => {
    const asked: string[] = [];
    const filledWhenAsked: unknown[] = [];
    const env = mount(async (defId) => {
      asked.push(defId);
      // the slot is not filled yet while the definition loads
      filledWhenAsked.push(env.icons());
      env.registered.set(defId, ICON);
      return true;
    });
    await env.commit('pack:icon');
    expect(asked).toEqual(['pack:icon']);
    expect(filledWhenAsked).toEqual([undefined]);
    expect(env.icons()).toEqual({ icon: { defId: 'pack:icon' } });
    expect(env.registered.get('pack:icon')).toBe(ICON);
  });

  it('FR-SHP-007: a registered definition is filled without a load, and a failed load still fills the slot', async () => {
    const asked: string[] = [];
    const env = mount(async (defId) => {
      asked.push(defId);
      return false;
    });
    await env.commit('test:card');
    expect(asked).toEqual([]);
    expect(env.icons()).toEqual({ icon: { defId: 'test:card' } });
    await env.commit('pack:missing');
    expect(asked).toEqual(['pack:missing']);
    expect(env.icons()).toEqual({ icon: { defId: 'pack:missing' } });
  });

  it('FR-SHP-007: a slow load does not overwrite a later commit of the same slot', async () => {
    let release: (ok: boolean) => void = () => undefined;
    const env = mount((defId) => {
      env.registered.set(defId, ICON);
      return new Promise<boolean>((r) => {
        release = r;
      });
    });
    // the first commit waits on its load; the second names a registered definition and fills at once
    await env.commit('pack:icon');
    await env.commit('test:card');
    expect(env.icons()).toEqual({ icon: { defId: 'test:card' } });
    await act(async () => {
      release(true);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(env.icons()).toEqual({ icon: { defId: 'test:card' } });
  });
  it('FR-SHP-007: a slow load on one shape still fills it after a commit to the same slot of another shape', async () => {
    const b = documentBuilder({ seed: 1939 });
    const screen = b.screen();
    const a = b.rect(screen, { x: 0, y: 0, w: 200, h: 100 }) as RecordId;
    const other = b.rect(screen, { x: 0, y: 200, w: 200, h: 100 }) as RecordId;
    const file = b.build();
    const records = { ...file.records } as Record<string, object>;
    for (const id of [a, other]) records[id] = { ...(records[id] as object), defId: CARD.id };
    const core = createCore({ ...file, records: records as DocumentFile['records'] });
    const registered = new Map<string, ShapeDef>([[CARD.id, CARD]]);
    const defs = { get: (k: string) => registered.get(k) };
    let release: (ok: boolean) => void = () => undefined;
    const ensureDef = (defId: string) => {
      registered.set(defId, ICON);
      return new Promise<boolean>((r) => {
        release = r;
      });
    };
    const show = (id: RecordId) =>
      act(() => root.render(<IconSlotsSection store={core.store} id={id} execute={core.execute} shapeDefs={defs} ensureDef={ensureDef} />));
    const commit = async (value: string) => {
      const input = host.querySelector('input[aria-label="Icon shape for icon"]') as HTMLInputElement;
      await act(async () => {
        input.focus();
        input.value = value;
        input.blur();
        await new Promise((r) => setTimeout(r, 0));
      });
    };
    const icons = (id: RecordId) => (core.store.get(id) as ShapeElement).icons;
    show(a);
    await commit('pack:icon');
    // the selection moves on and the other shape's slot is filled before the first load ends
    show(other);
    await commit('test:card');
    await act(async () => {
      release(true);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(icons(a)).toEqual({ icon: { defId: 'pack:icon' } });
    expect(icons(other)).toEqual({ icon: { defId: 'test:card' } });
  });
});
