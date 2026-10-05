import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// FR-PRS-004: presenting reads the document and never writes it. 500 random pointer and key events, drawn from a fixed seed, are sent to the one-file player
// and to present in place in the studio; the document is the same afterwards. The player's store refuses every write, so its document is read back as
// the embedded file (its hash) and as the screen drawn; the studio's as its transaction count.
const EVENTS = 500;

/** A small seeded generator (mulberry32): the same events on every run. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keys a fuzz may press: the deck's, the editor's edit chords and plain characters; none leaves the page or the mode (no Escape, F5, F11, F12). */
const KEYS = [
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'PageDown',
  'PageUp',
  'Home',
  'End',
  'Space',
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'a',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'l',
  'o',
  'p',
  'r',
  't',
  'v',
  'x',
  'z',
  '0',
  '1',
  '2',
  '3',
  '9',
  '?',
  '[',
  ']',
  'Control+z',
  'Control+Shift+z',
  'Control+a',
  'Control+c',
  'Control+x',
  'Control+v',
  'Control+d',
  'Control+g',
  'Shift+ArrowRight',
  'Alt+ArrowLeft',
];

/** What a fuzz does at a random point `p` (and a second one `q`): each is one kind of input. */
type Act = (page: Page, p: Point, q: Point, random: () => number) => Promise<unknown>;
type Point = { readonly x: number; readonly y: number };

/** The kinds of input, with their weights in 100 draws. */
const ACTS: readonly (readonly [number, Act])[] = [
  [35, (page, _p, _q, random) => page.keyboard.press(KEYS[Math.floor(random() * KEYS.length)] as string)],
  [15, (page, p) => page.mouse.click(p.x, p.y)],
  [8, (page, p) => page.mouse.dblclick(p.x, p.y)],
  [12, (page, p) => page.mouse.move(p.x, p.y, { steps: 3 })],
  [15, drag],
  [8, (page, _p, _q, random) => page.mouse.wheel((random() - 0.5) * 400, (random() - 0.5) * 400)],
  [7, (page, p) => page.mouse.click(p.x, p.y, { button: 'right' })],
];

/** Press at `p`, move to `q`, release. */
async function drag(page: Page, p: Point, q: Point): Promise<void> {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 3 });
  await page.mouse.up();
}

/** Send `count` random events: moves, clicks, double clicks, drags, wheel turns and keys. */
async function fuzz(page: Page, random: () => number, count: number): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const at = (): Point => ({ x: Math.floor(random() * size.width), y: Math.floor(random() * size.height) });
  for (let i = 0; i < count; i++) {
    const pick = random() * 100;
    const act = ACTS.find((_, i) => pick < ACTS.slice(0, i + 1).reduce((sum, [weight]) => sum + weight, 0)) ?? (ACTS[0] as (typeof ACTS)[number]);
    await act[1](page, at(), at(), random);
  }
}

test.describe('presenting never writes the document', { tag: '@desktop' }, () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-fuzz-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc20', { title: 'Fuzz' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** A hash of the document as the page holds it: every script of the page (the player and the embedded file). */
  const documentHash = (page: Page): Promise<string> =>
    page.evaluate(() => [...document.scripts].map((s) => s.textContent ?? '').join('\n')).then((text) => createHash('sha256').update(text).digest('hex'));

  /** Put the player back where it began: close what the keys opened and go to the first screen. */
  async function settle(page: Page): Promise<void> {
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen().catch(() => undefined));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Home');
  }

  test("FR-PRS-004: 500 random pointer and key events leave the one-file player's document unchanged", async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    const before = {
      hash: await documentHash(page),
      screen: await page
        .locator('.fx-screen')
        .first()
        .evaluate((el) => el.outerHTML.replace(/_r_[0-9a-z]+_/g, '_r_')),
    };
    await fuzz(page, seeded(20260511), EVENTS);
    await settle(page);
    await expect(page.getByTestId('player-deck')).toHaveAttribute('data-screen-index', '0');
    expect(await documentHash(page)).toBe(before.hash);
    // the screen drawn from the unchanged document is the one drawn first
    expect(
      await page
        .locator('.fx-screen')
        .first()
        .evaluate((el) => el.outerHTML.replace(/_r_[0-9a-z]+_/g, '_r_')),
    ).toBe(before.screen);
    expect(errors).toEqual([]);
  });

  test('FR-PRS-004: 500 random pointer and key events leave the document unchanged while presenting in place', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(1);
    await page.keyboard.press('F5');
    await expect(editor.root).toHaveAttribute('data-mode', 'present');
    const revision = await editor.root.getAttribute('data-revision');
    await fuzz(page, seeded(20260512), EVENTS);
    await expect(editor.root).toHaveAttribute('data-mode', 'present');
    expect(await editor.root.getAttribute('data-revision')).toBe(revision);
    // back in the editor the document is as it was: one element, no more
    await page.keyboard.press('Escape');
    await expect(editor.root).toHaveAttribute('data-mode', 'edit');
    await expect(editor.elements).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
