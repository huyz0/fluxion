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

/** Photographs each of `screens` from `html` into `dir`; the files written, or the outcome that says why not. */
export async function renderPngs(html: string, screens: readonly string[], dir: string, launch: Launcher): Promise<readonly string[] | Outcome> {
  let browser: Browser;
  try {
    browser = await launch();
  } catch (e) {
    return peerMissing(e instanceof Error ? (e.message.split('\n')[0] ?? 'launch failed') : String(e));
  }
  try {
    await mkdir(dir, { recursive: true });
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(html);
    const files: string[] = [];
    for (const id of screens) {
      const file = join(dir, `${id}.png`);
      await page.locator(`[data-screen-id="${id}"]`).screenshot({ path: file });
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
