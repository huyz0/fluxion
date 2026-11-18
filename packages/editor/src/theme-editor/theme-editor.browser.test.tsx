import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { contrastRatio } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../session.js';
import { ToolbarExtras } from '../toolbar-extras.js';
import { ThemeEditor } from './theme-editor.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  host.className = 'fx-editor';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function fresh() {
  const b = documentBuilder({ seed: 11 });
  const screen = b.screen();
  return { core: createCore(b.build()), screen: screen as RecordId };
}

const input = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
/** Type `value` into `el` as a user does: React reads the native setter's value on `input`. */
function enter(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;
const themeOf = (core: ReturnType<typeof createCore>) => {
  const id = (core.store.get(core.store.members('byType', 'document')[0] as never) as { themeId?: string }).themeId;
  return id === undefined ? undefined : (core.store.get(id as never) as unknown as { tokens: { color: Record<string, { $value: string }> } });
};
const previewVar = (name: string) => (host.querySelector('.fx-chrome-variants') as HTMLElement).style.getPropertyValue(name);

describe('theme editor panel (M20.11)', () => {
  it('FR-THM-007: one colour pick of many input events writes the theme live and is one undo step', () => {
    const { core, screen } = fresh();
    act(() => root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} />));
    const primary = input('primary colour');
    const depth = core.store.history.undoDepth;
    act(() => primary.focus());
    for (const hex of ['#aa0000', '#bb1111', '#e11d48']) {
      enter(primary, hex);
      // every input event is written at once: the theme record follows the pick
      expect(themeOf(core)?.tokens.color['primary']?.$value).toBe(hex);
    }
    act(() => primary.blur());
    expect(core.store.history.undoDepth).toBe(depth + 1);
    // a second pick is a second step
    act(() => primary.focus());
    enter(primary, '#0f766e');
    act(() => primary.blur());
    expect(core.store.history.undoDepth).toBe(depth + 2);
    act(() => core.store.history.undo());
    expect(input('primary colour').value).toBe('#e11d48');
    act(() => core.store.history.undo());
    expect(themeOf(core)).toBeUndefined();
    expect(input('primary colour').value).toBe('#2563eb');
  });

  it('FR-THM-004: with a master that does not apply, the editor follows the theme it edits through a pick and its undo', () => {
    const b = documentBuilder({ seed: 12 });
    const screen = b.screen() as RecordId;
    const plain = b.screen() as RecordId;
    const core = createCore(b.build());
    const get = (id: string) => core.store.get(id as RecordId) as unknown as Record<string, unknown>;
    const doc = core.store.members('byType', 'document')[0] as string;
    const theme = (name: string) => ({ id: `theme-${name}`, type: 'theme', name, tokens: { color: { primary: { $type: 'color', $value: '#123456' } } } });
    const puts = [theme('doc'), theme('m'), { ...get(doc), themeId: 'theme-doc' }, { ...get(plain), themeId: 'theme-m' }, { ...get(screen), masterId: plain }];
    expect(core.execute('document.applyRecords', { puts, deletes: [] }).ok).toBe(true);
    act(() => root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} />));
    const primary = input('primary colour');
    act(() => primary.focus());
    enter(primary, '#e11d48');
    act(() => primary.blur());
    // the editor shows the pick: it follows the record it writes
    expect(input('primary colour').value).toBe('#e11d48');
    // the document's theme is edited (the plain screen is no master, ADR-0054); the other stays as it was
    expect((get('theme-doc') as { tokens: { color: { primary: { $value: string } } } }).tokens.color.primary.$value).toBe('#e11d48');
    expect((get('theme-m') as { tokens: { color: { primary: { $value: string } } } }).tokens.color.primary.$value).toBe('#123456');
    act(() => core.store.history.undo());
    expect(input('primary colour').value).toBe('#123456');
  });

  it('FR-THM-006: the variant previews follow the edited theme', () => {
    const { core, screen } = fresh();
    act(() => root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} />));
    expect([...host.querySelectorAll('.fx-chrome-variant')].map((v) => v.getAttribute('data-variant'))).toEqual(['primary', 'subtle', 'outline', 'emphasis']);
    expect(previewVar('--fx-color-primary')).toBe('#2563eb');
    act(() => input('primary colour').focus());
    enter(input('primary colour'), '#e11d48');
    expect(previewVar('--fx-color-primary')).toBe('#e11d48');
  });

  it('FR-THM-005: Generate palette applies a palette from the seeds that keeps the locked roles, in one undo step', () => {
    const { core, screen } = fresh();
    act(() => root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} />));
    act(() => input('Lock primary').click());
    enter(host.querySelector('input[type="text"]') as HTMLInputElement, '#0f766e');
    const depth = core.store.history.undoDepth;
    act(() => button('Generate palette').click());
    expect(core.store.history.undoDepth).toBe(depth + 1);
    const colors = themeOf(core)?.tokens.color ?? {};
    expect(colors['primary']?.$value).toBe('#2563eb');
    expect(contrastRatio(colors['text']?.$value ?? '', colors['background']?.$value ?? '')).toBeGreaterThanOrEqual(4.5);
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/^Palette applied/);
    // Shuffle moves the unlocked hue slots and keeps the lock
    const secondary = colors['secondary']?.$value;
    act(() => button('Shuffle').click());
    expect(themeOf(core)?.tokens.color['primary']?.$value).toBe('#2563eb');
    expect(themeOf(core)?.tokens.color['secondary']?.$value).not.toBe(secondary);
  });

  it('FR-THM-007: Edit theme opens the editor from its lazy chunk beside the canvas, and Esc closes it', async () => {
    const { core, screen } = fresh();
    const session = createSession('doc');
    const props = { store: core.store, execute: core.execute, session, screenId: screen, fonts: undefined, assets: new Map() as never };
    act(() => root.render(<ToolbarExtras {...props} themes={[]} />));
    const edit = button('Edit theme');
    expect(edit.getAttribute('aria-expanded')).toBe('false');
    await act(async () => edit.click());
    await expect.poll(() => host.querySelector('[role="dialog"][aria-label="Theme editor"]')).not.toBeNull();
    const dialog = host.querySelector('[role="dialog"][aria-label="Theme editor"]') as HTMLElement;
    // non-modal: the canvas stays live beside it
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[aria-label="Theme editor"]')).toBeNull();
    expect(document.activeElement).toBe(button('Edit theme'));
  });
});
