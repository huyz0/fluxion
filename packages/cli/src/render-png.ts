// `render --format png` (ADR-0036): the static page is opened in headless Chromium and each screen is photographed to `<out>/<screen-id>.png`.
// Playwright is an optional peer, loaded with a dynamic import: without it, or without a browser, the reply is FLX_CLI_PEER_MISSING (exit 2).
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonPointer } from '@fluxion/schema';
import { io, type Outcome } from './command.js';

/**
 * What a page can photograph: one element, to a file or, with no path, to bytes.
 *
 * @public
 */
export type Shot = {
  /** Replaces the page with `html`. */
  readonly setContent: (html: string) => Promise<void>;
  /** Runs `fn(arg)` in the page and resolves with its result; needed to wait for embedded artwork fonts. */
  readonly evaluate?: <R, A>(fn: (arg: A) => R | Promise<R>, arg: A) => Promise<R>;
  /** The element matching `selector`. */
  readonly locator: (selector: string) => {
    /** Photographs the element; the PNG bytes when no `path` is given. */
    readonly screenshot: (options: { readonly path?: string }) => Promise<unknown>;
  };
};

/**
 * A launched headless browser.
 *
 * @public
 */
export type Browser = {
  /** Opens a page whose pixels are `deviceScaleFactor` per logical unit. */
  readonly newPage: (options: { readonly deviceScaleFactor: number }) => Promise<Shot>;
  /** Closes the browser. */
  readonly close: () => Promise<void>;
};

/**
 * Starts a headless Chromium; throws when the peer or the browser is absent.
 *
 * @public
 */
export type Launcher = () => Promise<Browser>;

/**
 * The Playwright module, found by name at run time so that installing the CLI needs no browser.
 *
 * @public
 */
export const playwrightLauncher: Launcher = async () => {
  const name = 'playwright';
  const module = (await import(name)) as { readonly chromium: { readonly launch: () => Promise<Browser> } };
  return module.chromium.launch();
};

const peerMissing = (reason: string): Outcome => ({
  exitCode: 2,
  diagnostics: [
    {
      code: 'FLX_CLI_PEER_MISSING',
      severity: 'error',
      path: jsonPointer(['argv']),
      message: `render --format png needs a headless Chromium: ${reason}`,
      hint: 'Run `pnpm add -D playwright && npx playwright install chromium`, or render --format html.',
    },
  ],
});

/** The families of `families` that did not load in the page, once its fonts are ready (all of them when the page cannot be asked). */
async function unloaded(page: Shot, families: readonly string[]): Promise<readonly string[]> {
  if (families.length === 0) return [];
  if (page.evaluate === undefined) return families;
  // runs in the page (serialized by Playwright), where the CLI's Node types do not describe the DOM
  return page.evaluate(async (names: readonly string[]) => {
    type PageFonts = { readonly ready: Promise<unknown>; load(font: string, text: string): Promise<readonly { readonly status: string }[]> };
    const set = (globalThis as unknown as { readonly document: { readonly fonts: PageFonts } }).document.fonts;
    await set.ready;
    const missing: string[] = [];
    for (const name of names) {
      const faces = await set.load(`16px "${name}"`, 'A').catch(() => []);
      if (faces.length === 0 || faces.some((face) => face.status !== 'loaded')) missing.push(name);
    }
    return missing;
  }, families);
}

/**
 * Photographs each of `screens` from `page` (its HTML, and the private families of the exact artwork fonts it embeds) into `dir`; the
 * files written, or the outcome that says why not. Those fonts must all load before the first photograph: one that does not refuses the render
 * (exit 1), so no artwork text is photographed in another face (ADR-0192).
 */
export async function renderPngs(
  page: string | { readonly html: string; readonly fonts: readonly string[] },
  screens: readonly string[],
  dir: string,
  launch: Launcher,
): Promise<readonly string[] | Outcome> {
  const { html, fonts } = typeof page === 'string' ? { html: page, fonts: [] } : page;
  let browser: Browser;
  try {
    browser = await launch();
  } catch (e) {
    return peerMissing(e instanceof Error ? (e.message.split('\n')[0] ?? 'launch failed') : String(e));
  }
  try {
    await mkdir(dir, { recursive: true });
    const shot = await browser.newPage({ deviceScaleFactor: 1 });
    await shot.setContent(html);
    const missing = await unloaded(shot, fonts);
    if (missing.length > 0) return io(`artwork font ${missing.join(', ')} could not be loaded; its text is not drawn in another face`, ['argv']);
    const files: string[] = [];
    for (const id of screens) {
      const file = join(dir, `${id}.png`);
      await shot.locator(`[data-screen-id="${id}"]`).screenshot({ path: file });
      files.push(file);
    }
    return files;
  } catch (e) {
    return io(`cannot write PNGs to ${dir}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  } finally {
    await browser.close();
  }
}

/**
 * Photographs one screen of `html` in memory at `scale` device pixels per unit; the PNG bytes, or the outcome that says why not.
 *
 * @internal
 */
export async function renderPngBytes(html: string, screen: string, scale: number, launch: Launcher): Promise<Uint8Array | Outcome> {
  let browser: Browser;
  try {
    browser = await launch();
  } catch (e) {
    return peerMissing(e instanceof Error ? (e.message.split('\n')[0] ?? 'launch failed') : String(e));
  }
  try {
    const page = await browser.newPage({ deviceScaleFactor: scale });
    await page.setContent(html);
    return (await page.locator(`[data-screen-id="${screen}"]`).screenshot({})) as Uint8Array;
  } catch (e) {
    return io(`cannot photograph screen ${screen}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  } finally {
    await browser.close();
  }
}
