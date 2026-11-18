import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { E2E_TIMEOUT, fluxion } from './spawn-bin.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fluxion-render-svg-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Reply = {
  ok: boolean;
  result?: { out: string; screens: number; files?: string[] };
  diagnostics?: { code: string; severity: string; path: string; message: string }[];
  errors?: { code: string }[];
};
/** `fluxion render … --json`: the exit status and the reply, parsed by the render schema. */
function render(args: readonly string[]) {
  const r = fluxion(['render', ...args, '--json']);
  const parsed = OUTPUT_SCHEMAS['render']?.safeParse(JSON.parse(r.stdout));
  expect(parsed?.success, parsed?.error?.message).toBe(true);
  return { status: r.status, reply: parsed?.data as Reply };
}

const DECK = 'fixtures/docs/r1-mvp-deck.flux.json';
/** The screens the deck shows, in order, as the `.flux.json` lists them. */
const deckScreens = () =>
  Object.values((JSON.parse(readFileSync(join(__dirname, '../../../../', DECK), 'utf8')) as DocumentFile).records)
    .filter((r) => r.type === 'screen')
    .map((r) => r.id);

/** One standalone SVG 1.1 file: an XML declaration and one root `<svg version="1.1">` for `screen`. */
function expectStandalone(svg: string, screen: string) {
  expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);
  expect(svg.endsWith('</svg>\n')).toBe(true);
  expect(svg).toMatch(/^<svg [^>]*version="1\.1"/m);
  expect(svg).toContain(`fluxion:screen="${screen}"`);
  // nothing outside the file: no script, no external reference
  expect(svg).not.toMatch(/<script|href="https?:|url\(https?:/i);
}

describe('fluxion render --format svg (FR-CLI-002, FR-EXP-004, ADR-0056)', { timeout: E2E_TIMEOUT }, () => {
  it('FR-CLI-002: render --format svg writes one SVG per screen', () => {
    const out = join(dir, 'deck');
    const { status, reply } = render([DECK, '-o', out, '--format', 'svg']);
    expect(status).toBe(0);
    const screens = deckScreens();
    expect(screens.length).toBeGreaterThan(1);
    // one file per screen the deck shows, named by its id
    const files = reply.result?.files ?? [];
    expect(reply.result).toMatchObject({ out, screens: screens.length });
    expect([...files].sort()).toEqual(screens.map((id) => join(out, `${id}.svg`)).sort());
    expect(readdirSync(out).sort()).toEqual(screens.map((id) => `${id}.svg`).sort());
    for (const file of files) {
      const svg = readFileSync(file, 'utf8');
      expectStandalone(svg, file.slice(out.length + 1, -'.svg'.length));
      // fonts are outlined by default: the bundled Inter draws every label as paths, none left to the viewer's fonts
      expect(svg).not.toMatch(/<text[\s>]/);
      expect(svg).not.toContain('@font-face');
    }
    // --screen picks the screens as for html and png
    const one = join(dir, 'one');
    const picked = render([DECK, '-o', one, '--format', 'svg', '--screen', screens[1] as string]);
    expect(picked.reply.result).toEqual({ out: one, screens: 1, files: [join(one, `${screens[1]}.svg`)] });
  });

  it('FR-CLI-002: --fonts embed writes each face once as a used-glyph subset that its text names first', () => {
    const out = join(dir, 'embed');
    const { status, reply } = render([DECK, '-o', out, '--format', 'svg', '--fonts', 'embed']);
    expect(status).toBe(0);
    const inter = readFileSync(join(__dirname, '../../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2'));
    for (const file of reply.result?.files ?? []) {
      const svg = readFileSync(file, 'utf8');
      const rules = [...svg.matchAll(/@font-face\{font-family:"(fx-export-[0-9a-f]{12})";src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g)];
      expect(rules.length).toBeGreaterThan(0);
      for (const [, alias, data] of rules) {
        // the subset job cut the bundled face: smaller than the whole file
        expect(Buffer.from(data as string, 'base64').length).toBeLessThan(inter.length);
        expect(svg).toContain(`font-family="&quot;${alias}&quot;, &quot;Inter&quot;`);
      }
      expect(svg).toMatch(/<text[\s>]/);
    }
    // a bundled face is a verified catalog font: none was embedded whole
    expect((reply.diagnostics ?? []).filter((w) => w.code === 'FLX_EXPORT_FONT_WHOLE')).toEqual([]);
  });

  it('FR-CLI-002: a font no face matches stays text naming its family, reported FLX_EXPORT_FONT_NOT_EMBEDDED at the screen', () => {
    const b = documentBuilder({ title: 'Georgia', seed: 2048 });
    const s = b.screen({ size: { w: 400, h: 200 } });
    const label = b.rect(s, { x: 20, y: 20, w: 360, h: 80, style: { font: { family: 'Georgia', size: 20 } } as never });
    const built = b.build();
    const text = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Serif' }] }] };
    const document = { ...built, records: { ...built.records, [label]: { ...built.records[label], text } } } as DocumentFile;
    const file = join(dir, 'georgia.flux.json');
    writeFileSync(file, serializeDocument(document));
    const out = join(dir, 'georgia');
    const { status, reply } = render([file, '-o', out, '--format', 'svg']);
    expect(status).toBe(0);
    const svg = readFileSync(join(out, `${s}.svg`), 'utf8');
    expectStandalone(svg, s);
    expect(svg).toMatch(/font-family="&quot;Georgia&quot;"[^>]*>/);
    expect(svg).toContain('>Serif</tspan>');
    expect(reply.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLX_EXPORT_FONT_NOT_EMBEDDED',
        severity: 'warning',
        path: `/records/${s}`,
        message: expect.stringContaining('Georgia'),
      }),
    );
  });

  it('FR-CLI-002: --fonts outside --format svg, or not outline or embed, is a usage error', () => {
    expect(render([DECK, '-o', join(dir, 'deck.html'), '--fonts', 'embed']).status).toBe(2);
    const bad = render([DECK, '-o', join(dir, 'x'), '--format', 'svg', '--fonts', 'bitmap']);
    expect(bad.status).toBe(2);
    expect(bad.reply.errors?.[0]?.code).toBe('FLX_CLI_USAGE');
  });
});
