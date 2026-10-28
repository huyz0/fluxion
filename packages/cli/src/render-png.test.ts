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

  it('FR-AST-003: an embedded artwork font that does not load refuses the render before any photograph (M18.116)', async () => {
    const alias = `fx-artwork-${'a'.repeat(64)}`;
    for (const evaluate of [async () => [alias], undefined]) {
      const log: string[] = [];
      const browser: Browser = {
        ...fakeBrowser(log),
        newPage: async () => ({ ...(await fakeBrowser(log).newPage({ deviceScaleFactor: 1 })), ...(evaluate ? { evaluate: evaluate as never } : {}) }),
      };
      const r = await renderPngs({ html: '<p>x</p>', fonts: [alias] }, ['a'], join(dir, 'unloaded'), async () => browser);
      expect(r).toMatchObject({ exitCode: 1, diagnostics: [{ code: 'FLX_CLI_IO', message: expect.stringContaining(alias) }] });
      expect(log.filter((l) => l.startsWith('shot:'))).toEqual([]);
      expect(log.at(-1)).toBe('closed');
    }
  });

  it('FR-AST-003: once every embedded artwork font has loaded, the screens are photographed (M18.116)', async () => {
    const log: string[] = [];
    const asked: unknown[] = [];
    const browser: Browser = {
      ...fakeBrowser(log),
      newPage: async () => ({
        ...(await fakeBrowser(log).newPage({ deviceScaleFactor: 1 })),
        evaluate: (async (_fn: unknown, arg: unknown) => {
          asked.push(arg);
          return [];
        }) as never,
      }),
    };
    const files = await renderPngs({ html: '<p>x</p>', fonts: ['fx-artwork-x'] }, ['a'], join(dir, 'loaded'), async () => browser);
    expect(files).toEqual([join(dir, 'loaded', 'a.png')]);
    expect(asked).toEqual([['fx-artwork-x']]);
  });
});
