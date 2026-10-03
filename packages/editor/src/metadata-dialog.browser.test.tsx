import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetadataDialog } from './metadata-dialog.js';
import { newDocument } from './new-document.js';

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

const setup = () => {
  const core = createCore(newDocument(seededRandom(12)));
  const doc = core.store.members('byType', 'document')[0] as never;
  const onClose = vi.fn();
  return { core, doc, onClose };
};
const record = (core: ReturnType<typeof setup>['core'], doc: never) => core.store.get(doc) as unknown as { [k: string]: unknown };

/** Type `value` into an input or textarea the way a person does. */
async function type(element: Element | null, value: string) {
  if (element === null) throw new Error('no such field');
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const input = (label: string) =>
  host.querySelector(`label input[type="text"], label textarea`) &&
  ([...host.querySelectorAll('label')].find((l) => l.firstChild?.textContent === label)?.querySelector('input, textarea') ?? null);
const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name) as HTMLButtonElement;
const click = (name: string) => act(async () => button(name).click());

describe('<MetadataDialog> (FR-DOC-006)', () => {
  it('FR-DOC-006: saving writes the fields and the clock reading in one undo step, and reopening shows what was saved', async () => {
    const { core, doc, onClose } = setup();
    const show = () =>
      act(async () => root.render(<MetadataDialog store={core.store} execute={core.execute} now={() => '2026-05-06T07:08:09Z'} onClose={onClose} />));
    await show();
    await type(input('Title'), 'Quarterly review');
    await type(input('Description'), 'Numbers for Q3');
    await type(input('Language'), 'en-GB');
    await type(input('Authors'), 'Ada, Grace');
    await type(input('Tags'), 'finance, q3');
    await click('Add a custom field');
    await type(host.querySelector('[aria-label="Custom field 1 name"]'), 'team');
    await type(host.querySelector('[aria-label="Custom field 1 value"]'), 'finance');
    await click('Save');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(record(core, doc)).toMatchObject({
      title: 'Quarterly review',
      description: 'Numbers for Q3',
      lang: 'en-GB',
      authors: ['Ada', 'Grace'],
      tags: ['finance', 'q3'],
      custom: { team: 'finance' },
      modified: '2026-05-06T07:08:09Z',
    });
    expect(core.store.history.undoDepth).toBe(1);
    // reopened: the dialog shows what is stored
    act(() => root.unmount());
    root = createRoot(host);
    await show();
    expect((input('Title') as HTMLInputElement).value).toBe('Quarterly review');
    expect((input('Authors') as HTMLInputElement).value).toBe('Ada, Grace');
    expect((host.querySelector('[aria-label="Custom field 1 value"]') as HTMLInputElement).value).toBe('finance');
    // one undo takes it all back
    core.store.history.undo();
    expect(record(core, doc)['title']).toBeUndefined();
    expect(record(core, doc)['custom']).toBeUndefined();
  });

  it('FR-DOC-006: Tab stays in the dialog: Shift+Tab from Title wraps to Cancel, Tab from Cancel wraps to Title', async () => {
    const { core, onClose } = setup();
    await act(async () => root.render(<MetadataDialog store={core.store} execute={core.execute} onClose={onClose} />));
    const press = async (target: Element | null, shiftKey: boolean) => {
      if (target === null) throw new Error('no such control');
      (target as HTMLElement).focus();
      await act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
      });
    };
    await press(input('Title'), true);
    expect(document.activeElement).toBe(button('Cancel'));
    await press(button('Cancel'), false);
    expect(document.activeElement).toBe(input('Title'));
  });

  it('FR-DOC-006: Cancel and Esc write nothing; a bad language or a repeated custom name blocks Save and says why', async () => {
    const { core, onClose } = setup();
    const before = core.store.toDocument();
    await act(async () => root.render(<MetadataDialog store={core.store} execute={core.execute} onClose={onClose} />));
    await type(input('Title'), 'Never saved');
    await type(input('Language'), 'not a tag');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('language tag');
    expect(button('Save').disabled).toBe(true);
    await type(input('Language'), 'fr');
    expect(button('Save').disabled).toBe(false);
    await click('Add a custom field');
    await click('Add a custom field');
    await type(host.querySelector('[aria-label="Custom field 1 name"]'), 'a');
    await type(host.querySelector('[aria-label="Custom field 2 name"]'), 'a');
    expect(host.textContent).toContain('custom field names must differ');
    expect(button('Save').disabled).toBe(true);
    await click('Remove custom field 2');
    expect(button('Save').disabled).toBe(false);
    await click('Cancel');
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(core.store.toDocument()).toEqual(before);
  });

  it('FR-DOC-006: when the document refuses the write, the dialog stays open and says so', async () => {
    const { core, onClose } = setup();
    await act(async () =>
      root.render(
        <MetadataDialog
          store={core.store}
          execute={() => ({ ok: false, error: { code: 'COMMAND_UNKNOWN', message: 'nope', diagnostics: [] } })}
          onClose={onClose}
        />,
      ),
    );
    await click('Save');
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('nope');
  });

  it('FR-DOC-006: without a clock of its own the dialog stamps a real ISO time', async () => {
    const { core, doc, onClose } = setup();
    await act(async () => root.render(<MetadataDialog store={core.store} execute={core.execute} onClose={onClose} />));
    await click('Save');
    expect(String(record(core, doc)['modified'])).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });
});
