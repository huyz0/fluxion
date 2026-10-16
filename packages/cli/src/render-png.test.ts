import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Browser, renderPngs } from './render-png.js';

const dir = mkdtempSync(join(tmpdir(), 'fluxion-png-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A browser that records what it was asked and writes a stand-in file per screenshot. */
function fakeBrowser(log: string[]): Browser {
  return {
    newPage: async () => ({
      setContent: async (html) => {
        log.push(`content:${html}`);
      },
      locator: (selector) => ({
        screenshot: async ({ path }) => {
          log.push(`shot:${selector}`);
          writeFileSync(path ?? '', 'png');
        },
      }),
    }),
    close: async () => {
      log.push('closed');
    },
  };
}

describe('renderPngs (FR-AI-006, ADR-0036)', () => {
  it('FR-AI-006: photographs each screen to <dir>/<id>.png and closes the browser', async () => {
    const log: string[] = [];
    const out = join(dir, 'shots');
    const files = await renderPngs('<p>x</p>', ['a', 'b'], out, async () => fakeBrowser(log));
    expect(files).toEqual([join(out, 'a.png'), join(out, 'b.png')]);
    expect(log).toEqual(['content:<p>x</p>', 'shot:[data-screen-id="a"]', 'shot:[data-screen-id="b"]', 'closed']);
  });

  it('FR-AI-006: a browser that cannot start is FLX_CLI_PEER_MISSING, exit 2, with the install hint', async () => {
    const r = await renderPngs('', ['a'], join(dir, 'none'), () => Promise.reject(new Error("Executable doesn't exist\nat /x")));
    expect(r).toMatchObject({ exitCode: 2, diagnostics: [{ code: 'FLX_CLI_PEER_MISSING' }] });
    const [d] = (r as unknown as { diagnostics: { message: string; hint: string }[] }).diagnostics;
    expect(d?.message).toContain("Executable doesn't exist");
    expect(d?.hint).toContain('playwright install chromium');
  });

  it('FR-AI-006: a screenshot that fails is FLX_CLI_IO, exit 1, and the browser is still closed', async () => {
    const log: string[] = [];
    const browser: Browser = {
      ...fakeBrowser(log),
      newPage: async () => ({ setContent: async () => undefined, locator: () => ({ screenshot: () => Promise.reject(new Error('boom')) }) }),
    };
    const r = await renderPngs('', ['a'], join(dir, 'fail'), async () => browser);
    expect(r).toMatchObject({ exitCode: 1, diagnostics: [{ code: 'FLX_CLI_IO' }] });
    expect(log).toEqual(['closed']);
  });
});
