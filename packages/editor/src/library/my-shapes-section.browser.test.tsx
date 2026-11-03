import { writable } from '@fluxion/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MyShape, MyShapes, MyShapesResult } from './my-shapes.js';
import { MyShapesSection, type MyShapesSectionProps } from './my-shapes-section.js';

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

const item = (id: string, name: string, defIds: readonly string[] = []): MyShape => ({
  id,
  name,
  payload: { records: defIds.map((defId) => ({ kind: 'shape', defId })) } as unknown as MyShape['payload'],
});

/** In-memory My shapes; `refuse` makes put and import refuse. */
function fakeMyShapes(initial: readonly MyShape[], refuse: { put: boolean; import: boolean; remove?: boolean } = { put: false, import: false }): MyShapes {
  const items = writable<readonly MyShape[]>(initial);
  return {
    available: (defId) => defId.startsWith('basic:'),
    items: items.get,
    put: (i) => {
      if (refuse.put) return false;
      items.set([...items.get().filter((x) => x.id !== i.id), i]);
      return true;
    },
    remove: (id) => {
      if (refuse.remove === true) return false;
      items.set(items.get().filter((x) => x.id !== id));
      return true;
    },
    importFile: (): MyShapesResult<number> => (refuse.import ? { ok: false, reason: 'it is not a My shapes file' } : { ok: true, value: 0 }),
  };
}

async function render(over: Partial<MyShapesSectionProps> = {}) {
  const told: string[] = [];
  const saved: string[] = [];
  const props: MyShapesSectionProps = {
    myShapes: fakeMyShapes([item('a', 'Pair'), item('b', 'Trio')]),
    canSave: true,
    onSave: async (name) => {
      saved.push(name);
      return { ok: true, value: undefined };
    },
    onInsert: () => {},
    onExport: () => {},
    notify: (m) => told.push(m),
    ...over,
  };
  await act(async () => root.render(<MyShapesSection {...props} />));
  return { told, saved, props };
}
const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name) as HTMLButtonElement;
const names = () => [...host.querySelectorAll('[data-mine="insert"]')].map((b) => b.textContent);
const nameBox = () => host.querySelector('input[type="text"]') as HTMLInputElement;
async function type(value: string) {
  const box = nameBox();
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('My shapes section (FR-LIB-008)', () => {
  it('FR-LIB-008: a removed item comes back with Undo, and focus moves to Undo and then to the item', async () => {
    const { props } = await render();
    expect(names()).toEqual(['Pair', 'Trio']);
    await act(async () => button('Remove Pair from My shapes').click());
    expect(names()).toEqual(['Trio']);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Removed Pair.');
    expect(document.activeElement).toBe(button('Undo'));
    await act(async () => button('Undo').click());
    expect(props.myShapes.items().map((i) => i.id)).toEqual(['b', 'a']);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Pair');
  });

  it('FR-LIB-008: a stored item whose shapes are not available here is listed as unavailable, with why shown, and cannot be inserted (cp32 F4)', async () => {
    const inserted: string[] = [];
    await render({ myShapes: fakeMyShapes([item('a', 'Pair', ['basic:rect']), item('b', 'Flow', ['flow:decision'])]), onInsert: (i) => inserted.push(i.id) });
    expect(names()).toEqual(['Pair', 'Flow (unavailable)']);
    const flow = button('Flow (unavailable)');
    expect(flow.disabled).toBe(true);
    // the reason is visible text, not only a tooltip, and is the button's description
    const reason = document.getElementById(flow.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe('Unavailable: it uses shapes that are not built in: flow:decision');
    expect(reason?.checkVisibility()).toBe(true);
    expect(button('Pair').hasAttribute('aria-describedby')).toBe(false);
    await act(async () => flow.click());
    await act(async () => button('Pair').click());
    expect(inserted).toEqual(['a']);
  });

  it('FR-LIB-008, FR-LIB-009: an item whose other shapes its packs carry is listed as available and inserts (M18.122 r1 F1)', async () => {
    const inserted: string[] = [];
    const packs = [{ subset: { id: 'flow', definitions: [{ id: 'flow:decision' }] }, fonts: {} }] as unknown as NonNullable<MyShape['packs']>;
    await render({ myShapes: fakeMyShapes([{ ...item('b', 'Flow', ['flow:decision']), packs }]), onInsert: (i) => inserted.push(i.id) });
    expect(names()).toEqual(['Flow']);
    expect(button('Flow').disabled).toBe(false);
    await act(async () => button('Flow').click());
    expect(inserted).toEqual(['b']);
  });

  it('FR-LIB-008: an undo storage refuses is told, not silently lost', async () => {
    const { told } = await render({ myShapes: fakeMyShapes([item('a', 'Pair')], { put: true, import: false }) });
    await act(async () => button('Remove Pair from My shapes').click());
    await act(async () => button('Undo').click());
    expect(told).toEqual(['Pair could not be put back in My shapes.']);
    // M18.130: the removal stays offered and focus stays on its Undo, never the page body
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Removed Pair.');
    expect(document.activeElement).toBe(button('Undo'));
  });

  it('FR-LIB-008: a remove storage refuses is told, keeps the item and offers no Undo (M18.35 r4 F1)', async () => {
    const { told } = await render({ myShapes: fakeMyShapes([item('a', 'Pair')], { put: false, import: false, remove: true }) });
    await act(async () => button('Remove Pair from My shapes').click());
    expect(told).toEqual(['Pair could not be removed from My shapes.']);
    expect(names()).toEqual(['Pair']);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('FR-LIB-008: every removal in a row can be undone, latest first (M18.130)', async () => {
    const { props } = await render();
    await act(async () => button('Remove Pair from My shapes').click());
    await act(async () => button('Remove Trio from My shapes').click());
    expect(names()).toEqual([]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Removed Trio.');
    await act(async () => button('Undo').click());
    expect(document.activeElement?.textContent).toBe('Trio');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Removed Pair.');
    await act(async () => button('Undo').click());
    expect(props.myShapes.items().map((i) => i.id)).toEqual(['b', 'a']);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('FR-LIB-008: when the control focus would return to is disabled, focus stays in the section (M18.130)', async () => {
    let canSave = true;
    const props = await render({
      onSave: async () => {
        canSave = false;
        return { ok: true, value: undefined };
      },
    });
    await act(async () => button('Save selection to My shapes').click());
    await type('Pipe');
    await act(async () => {
      button('Save').click();
      root.render(<MyShapesSection {...props.props} canSave={canSave} />);
    });
    expect(canSave).toBe(false);
    expect(document.activeElement).toBe(host.querySelector('section'));
  });

  it('FR-LIB-008: Save is disabled for a blank name, Escape cancels, and focus returns to the Save selection button', async () => {
    const { saved } = await render();
    await act(async () => button('Save selection to My shapes').click());
    expect(document.activeElement).toBe(nameBox());
    expect(button('Save').disabled).toBe(true);
    await type('   ');
    expect(button('Save').disabled).toBe(true);
    await type('Pipe');
    expect(button('Save').disabled).toBe(false);
    await act(async () => nameBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(nameBox()).toBeNull();
    expect(saved).toEqual([]);
    expect(document.activeElement).toBe(button('Save selection to My shapes'));
    // saved under a name: the form closes and focus returns too
    await act(async () => button('Save selection to My shapes').click());
    await type('Pipe');
    await act(async () => button('Save').click());
    expect(saved).toEqual(['Pipe']);
    expect(document.activeElement).toBe(button('Save selection to My shapes'));
  });

  it('FR-LIB-008: nothing selected disables saving, and a refused save is told with its reason', async () => {
    await render({ canSave: false });
    expect(button('Save selection to My shapes').disabled).toBe(true);
    const { told } = await render({ onSave: async () => ({ ok: false, reason: 'it uses shapes that are not built in: x:y' }) });
    await act(async () => button('Save selection to My shapes').click());
    await type('Pipe');
    await act(async () => button('Save').click());
    expect(told).toEqual(['The selection could not be saved to My shapes: it uses shapes that are not built in: x:y.']);
  });

  it('FR-LIB-008: a refused import and an unreadable file are told', async () => {
    const { told } = await render({ myShapes: fakeMyShapes([], { put: false, import: true }) });
    expect(button('Export My shapes').disabled).toBe(true);
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const pick = async (file: File) => {
      const list = new DataTransfer();
      list.items.add(file);
      input.files = list.files;
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
    };
    await pick(new File(['{}'], 'mine.json'));
    await expect.poll(() => told).toEqual(['That file could not be imported: it is not a My shapes file.']);
    const broken = new File(['{}'], 'broken.json');
    broken.text = () => Promise.reject(new Error('gone'));
    await pick(broken);
    await expect.poll(() => told.at(-1)).toBe('That file could not be read.');
  });

  it('FR-LIB-008: a click on an item inserts it, and Export hands over the file text', async () => {
    const inserted: string[] = [];
    const exported: string[] = [];
    await render({ onInsert: (i) => inserted.push(i.id), onExport: (text) => exported.push(text) });
    await act(async () => button('Trio').click());
    expect(inserted).toEqual(['b']);
    await act(async () => button('Export My shapes').click());
    expect(JSON.parse(exported[0] as string)).toMatchObject({ format: 'fluxion-my-shapes', items: [{ id: 'a' }, { id: 'b' }] });
  });
});
