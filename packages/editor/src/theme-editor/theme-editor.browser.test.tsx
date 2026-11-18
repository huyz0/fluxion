import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { contrastRatio, importDtcg, themeOf as readTheme, themeToCss } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../session.js';
import { ToolbarExtras } from '../toolbar-extras.js';
import { ThemeEditor } from './theme-editor.js';
import type { ThemeFile } from './theme-files.js';

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

/** Hand `input` the file `file` as a person picking it does. */
function choose(el: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  act(() => {
    el.files = transfer.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
/** The file input the label reading `text` wraps. */
const fileInput = (text: string) =>
  [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(text))?.querySelector('input[type="file"]') as HTMLInputElement;
const statuses = () => [...host.querySelectorAll('[role="status"]')].map((s) => s.textContent ?? '');
/** A PNG of a red and a blue half, `w` × `h`. */
async function twoColourPng(w: number, h: number): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#dc2626';
  g.fillRect(0, 0, w / 2, h);
  g.fillStyle = '#2563eb';
  g.fillRect(w / 2, 0, w / 2, h);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/png'));
  return new File([blob], 'two.png', { type: 'image/png' });
}
/** The theme the document's theme record holds. */
const documentTheme = (core: ReturnType<typeof createCore>) => {
  const id = (core.store.get(core.store.members('byType', 'document')[0] as never) as { themeId?: string }).themeId;
  return readTheme(core.store.get(id as never) as never);
};

describe('theme editor files and image seeds (M20.38)', () => {
  it('FR-THM-005: an image picked in the theme editor fills the seeds and generates its palette in one undo step', async () => {
    const { core, screen } = fresh();
    act(() => root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} />));
    const depth = core.store.history.undoDepth;
    const decode = vi.spyOn(window, 'createImageBitmap');
    // larger than the 256 px decode: the browser scales it down before the pixels are read
    choose(fileInput('Seeds from an image'), await twoColourPng(600, 300));
    await vi.waitFor(() => expect(statuses()[0]).toMatch(/^Palette applied/));
    // the pixels read are those of the image decoded at 256 px on its longest side
    expect(decode.mock.calls.at(-1)?.[1]).toMatchObject({ resizeWidth: 256, resizeHeight: 128 });
    decode.mockRestore();
    const seeds = [...host.querySelectorAll<HTMLInputElement>('input[type="text"]')].map((i) => i.value);
    expect(seeds.filter((v) => /^#[0-9a-f]{6}$/.test(v)).length).toBe(2);
    expect(core.store.history.undoDepth).toBe(depth + 1);
    const colors = themeOf(core)?.tokens.color ?? {};
    expect(contrastRatio(colors['text']?.$value ?? '', colors['background']?.$value ?? '')).toBeGreaterThanOrEqual(4.5);
    act(() => core.store.history.undo());
    expect(themeOf(core)).toBeUndefined();
  });

  it('FR-THM-007: Export theme file hands over <slug>.tokens.json, which re-imports deep-equal', () => {
    const { core, screen } = fresh();
    const files: ThemeFile[] = [];
    act(() =>
      root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} download={(f) => files.push(f)} />),
    );
    act(() => input('primary colour').focus());
    enter(input('primary colour'), '#e11d48');
    act(() => input('primary colour').blur());
    act(() => button('Export theme file').click());
    expect(files.map((f) => f.name)).toEqual(['light.tokens.json']);
    const back = importDtcg(JSON.parse(files[0]?.text ?? ''));
    expect(back.ok && back.value.warnings).toEqual([]);
    expect(back.ok && back.value.theme).toEqual(documentTheme(core));
  });

  it('FR-THM-009: Export CSS hands over the CSS variables of the edited theme as a separate file', () => {
    const { core, screen } = fresh();
    const files: ThemeFile[] = [];
    act(() =>
      root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} download={(f) => files.push(f)} />),
    );
    act(() => input('primary colour').focus());
    enter(input('primary colour'), '#0f766e');
    act(() => button('Export CSS').click());
    expect(files.map((f) => [f.name, f.type])).toEqual([['light.css', 'text/css']]);
    expect(files[0]?.text).toBe(themeToCss(documentTheme(core) as never));
    expect(files[0]?.text).toContain('--fx-color-primary: #0f766e;');
  });

  it('FR-THM-009: a foreign DTCG file imported in the theme editor is added as a theme record in one undo step, its warnings listed', async () => {
    const { core, screen } = fresh();
    act(() => root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} />));
    const foreign = {
      color: {
        brand: { $type: 'color', $value: '#7c3aed' },
        primary: { $type: 'color', $value: '{color.brand}' },
        gone: { $type: 'color', $value: '{color.none}' },
      },
    };
    const depth = core.store.history.undoDepth;
    choose(fileInput('Import theme file'), new File([JSON.stringify(foreign)], 'brand.tokens.json', { type: 'application/json' }));
    await vi.waitFor(() => expect(statuses()[1]).toMatch(/^Imported /));
    expect(core.store.history.undoDepth).toBe(depth + 1);
    // the screen is now drawn with the imported theme, and the editor edits it
    expect(themeOf(core)?.tokens.color['brand']?.$value).toBe('#7c3aed');
    expect(input('primary colour').value).toBe('#7c3aed');
    const warnings = [...host.querySelectorAll('[aria-label="Theme file warnings"] li')].map((li) => li.textContent ?? '');
    // each listed once, as importDtcg words it (the message names its path)
    const gone = warnings.filter((w) => w.includes('color.gone'));
    expect(gone.length).toBe(1);
    expect(gone[0]).toMatch(/^color\.gone: /);
    expect(gone[0]).not.toMatch(/^color\.gone: color\.gone/);
    act(() => core.store.history.undo());
    expect(themeOf(core)).toBeUndefined();
    // the same file picked again is a new import
    choose(fileInput('Import theme file'), new File([JSON.stringify(foreign)], 'brand.tokens.json', { type: 'application/json' }));
    await vi.waitFor(() => expect(themeOf(core)?.tokens.color['brand']?.$value).toBe('#7c3aed'));
  });

  it('FR-THM-007: a Fluxion theme file imported in the theme editor adds a new theme record beside the edited one', async () => {
    const { core, screen } = fresh();
    const files: ThemeFile[] = [];
    act(() =>
      root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} download={(f) => files.push(f)} />),
    );
    act(() => input('primary colour').focus());
    enter(input('primary colour'), '#e11d48');
    act(() => input('primary colour').blur());
    act(() => button('Export theme file').click());
    const before = core.store.members('byType', 'theme').length;
    choose(fileInput('Import theme file'), new File([files[0]?.text ?? ''], 'light.tokens.json', { type: 'application/json' }));
    await vi.waitFor(() => expect(statuses()[1]).toBe('Imported light.'));
    // never overwritten: a second record under a free id, which the document now names
    expect(core.store.members('byType', 'theme').length).toBe(before + 1);
    expect((core.store.get(core.store.members('byType', 'document')[0] as never) as { themeId?: string }).themeId).toBe('theme-light-2');
    expect(host.querySelector('[aria-label="Theme file warnings"]')).toBeNull();
    // a file that is not JSON is refused and nothing is written
    choose(fileInput('Import theme file'), new File(['not json'], 'x.json'));
    await vi.waitFor(() => expect(statuses()[1]).toBe('the file is not JSON'));
    expect(core.store.members('byType', 'theme').length).toBe(before + 1);
  });

  it('FR-THM-007: Export theme file lists the tokens the file leaves out', () => {
    const { core, screen } = fresh();
    const doc = core.store.members('byType', 'document')[0] as string;
    const odd = { id: 'theme-odd', type: 'theme', name: 'odd', tokens: { color: { primary: { $type: 'color', $value: 'currentColor' } } } };
    const put = [odd, { ...(core.store.get(doc as never) as object), themeId: 'theme-odd' }];
    expect(core.execute('document.applyRecords', { puts: put, deletes: [] }).ok).toBe(true);
    const files: ThemeFile[] = [];
    act(() =>
      root.render(<ThemeEditor store={core.store} execute={core.execute} screenId={screen} onClose={() => undefined} download={(f) => files.push(f)} />),
    );
    act(() => button('Export theme file').click());
    expect(files.map((f) => f.name)).toEqual(['odd.tokens.json']);
    expect(statuses()[1]).toBe('Exported odd.tokens.json; tokens left out are listed.');
    const listed = [...host.querySelectorAll('[aria-label="Theme file warnings"] li')].map((li) => li.textContent ?? '');
    expect(listed).toEqual([expect.stringMatching(/^color\.primary: .*left out$/)]);
  });
});
