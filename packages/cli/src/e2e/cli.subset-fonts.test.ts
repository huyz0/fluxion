import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFlux, readFluxHtml, sha256Hex, writeFlux, writePortableFlux } from '@fluxion/format';
import type { DocumentFile } from '@fluxion/schema';
import { allowsShapePackContentLicense } from '@fluxion/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { E2E_TIMEOUT, fluxion, REPO } from './spawn-bin.js';

// `fluxion convert --subset-fonts` on real files (FR-AST-003, ADR-0051, ADR-0201, M18.40): the built bin subsets an embedded catalog font in a
// worker thread, the written .flux reopens with a validated WOFF2 subset that names its source, and a font that may not be subset stays whole.
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const FIRA = new Uint8Array(readFileSync(join(REPO, 'fixtures/fonts/fira-sans-400.ttf')));
const INTER = new Uint8Array(readFileSync(join(REPO, 'packs/fonts-core/fonts/inter-latin-400-normal.woff2')));
const opening = { hasher, shapePackLicensePolicy: allowsShapePackContentLicense };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fluxion-subset-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A `.flux` with one text element drawn in Fira Sans from `source`, written to `dir`; with `artwork`, also a saved 1.1 pack's label drawn in exact Inter. */
async function fluxWithFont(source: string, artwork = false): Promise<string> {
  const hash = sha256Hex(FIRA);
  const font = { family: 'Fira Sans', weight: 400, style: 'normal', source, license: 'OFL-1.1', copyright: 'Copyright 2012 Mozilla' };
  const text = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Subset office façade' }] }] };
  const records = {
    d: { id: 'd', type: 'document', title: 'Fonts' },
    s1: { id: 's1', type: 'screen', name: 'One', index: 'a0' },
    e1: { id: 'e1', type: 'element', kind: 'text', screenId: 's1', index: 'a0', transform: { x: 0, y: 0, w: 400, h: 60, rotation: 0 }, text },
    f1: { id: 'f1', type: 'asset', hash, mime: 'font/ttf', size: FIRA.length, name: 'FiraSans-Regular.ttf', font },
  };
  const label = { id: 'l1', type: 'element', kind: 'shape', screenId: 's1', index: 'a1', defId: 'sample:label', transform: { x: 40, y: 80, w: 320, h: 160 } };
  const document = { schemaVersion: '1.7', records: artwork ? { ...records, l1: label } : records } as unknown as DocumentFile;
  const assets = new Map([[hash, { bytes: FIRA, mime: 'font/ttf' }]]);
  const path = join(dir, `${source}${artwork ? '-artwork' : ''}.flux`);
  if (!artwork) {
    const written = await writeFlux({ document, assets, appVersion: '1.0.0', hasher, source: 'flux: 1\n' });
    if (!written.ok) throw new Error(written.error.reason);
    writeFileSync(path, written.value);
    return path;
  }
  const subset = JSON.parse(readFileSync(join(REPO, 'fixtures/shape-pack/v1.1/subset.json'), 'utf8'));
  const written = await writePortableFlux({
    document,
    assets,
    appVersion: '1.0.0',
    hasher,
    source: 'flux: 1\n',
    shapePacks: {
      sources: [{ kind: 'embedded', subset, fonts: new Map([[sha256Hex(INTER), INTER]]) }],
      builtinIds: new Set(),
      licensePolicy: allowsShapePackContentLicense,
    },
  });
  if (!written.ok) throw new Error(written.error.reason);
  writeFileSync(path, written.value.bytes);
  return path;
}

type FontLine = { asset: string; status: string; reason?: string; before: number; after: number };
type Reply = { ok: boolean; result?: { direction: string; bytes: number; fonts?: FontLine[] } };
function convert(...args: string[]): { status: number | null; reply: Reply } {
  const r = fluxion(['convert', ...args, '--json']);
  const parsed = OUTPUT_SCHEMAS['convert']?.safeParse(JSON.parse(r.stdout));
  expect(parsed?.success, parsed?.error?.message).toBe(true);
  return { status: r.status, reply: parsed?.data as Reply };
}

describe('fluxion convert --subset-fonts (FR-AST-003, ADR-0201)', () => {
  it(
    'FR-AST-003: rewrites a .flux with a validated subset that keeps the source, and a .flux.html embeds the subset file',
    async () => {
      const input = await fluxWithFont('google');
      const out = join(dir, 'subset.flux');
      const { status, reply } = convert(input, out, '--subset-fonts');
      expect(status).toBe(0);
      expect(reply.result?.fonts).toMatchObject([{ asset: 'f1', status: 'subset', before: FIRA.length }]);
      const opened = await loadFlux(readFileSync(out), { hasher });
      if (!opened.ok) throw new Error(opened.error.message);
      const record = opened.value.document.records['f1' as never] as unknown as {
        hash: string;
        mime: string;
        name: string;
        font: { subset: { source: string } };
      };
      expect(record).toMatchObject({ mime: 'font/woff2', name: 'FiraSans-Regular.woff2' });
      expect(record.font.subset.source).toBe(sha256Hex(FIRA));
      const bytes = opened.value.assets.get(record.hash)?.bytes as Uint8Array;
      expect(sha256Hex(bytes)).toBe(record.hash);
      expect(bytes.length).toBeLessThan(60_000);
      expect(opened.value.assets.has(sha256Hex(FIRA))).toBe(false);
      expect(opened.value.source).toBe('flux: 1\n');
      const html = join(dir, 'subset.flux.html');
      const page = convert(input, html, '--subset-fonts');
      expect(page.reply.result).toMatchObject({ direction: 'to-html', fonts: [{ status: 'subset' }] });
      const embedded = await readFluxHtml(readFileSync(html, 'utf8'), hasher);
      if (!embedded.ok) throw new Error(embedded.error.message);
      const inner = await loadFlux(embedded.value, { hasher });
      expect(inner.ok && (inner.value.document.records['f1' as never] as unknown as { mime: string }).mime).toBe('font/woff2');
    },
    E2E_TIMEOUT,
  );

  it(
    'FR-AST-003 FR-LIB-004: a file with a saved 1.1 pack subsets its text font and keeps the pack and its exact artwork font bytes',
    async () => {
      const input = await fluxWithFont('google', true);
      const out = join(dir, 'artwork-subset.flux');
      const { status, reply } = convert(input, out, '--subset-fonts');
      expect(status).toBe(0);
      expect(reply.result?.fonts).toMatchObject([{ asset: 'f1', status: 'subset' }]);
      const opened = await loadFlux(readFileSync(out), opening);
      if (!opened.ok) throw new Error(opened.error.message);
      expect(opened.value.shapePacks.flatMap((p) => p.definitions.map((d) => d.id))).toContain('sample:label');
      const inter = opened.value.assets.get(sha256Hex(INTER))?.bytes;
      expect(inter && sha256Hex(inter)).toBe(sha256Hex(INTER));
      expect((opened.value.document.records['f1' as never] as unknown as { mime: string }).mime).toBe('font/woff2');
    },
    E2E_TIMEOUT,
  );

  it(
    'FR-AST-003: a font that may not be subset is written whole with its reason, and the option only applies to .flux outputs',
    async () => {
      const input = await fluxWithFont('upload');
      const out = join(dir, 'kept.flux');
      const { status, reply } = convert(input, out, '--subset-fonts');
      expect(status).toBe(0);
      expect(reply.result?.fonts).toMatchObject([{ status: 'kept', reason: 'unverified-source', after: FIRA.length }]);
      expect(readFileSync(out)).toEqual(readFileSync(input));
      const json = convert(input, join(dir, 'x.flux.json'), '--subset-fonts');
      expect(json.status).toBe(2);
      // without the option a .flux is never rewritten as a .flux
      expect(convert(input, join(dir, 'same.flux')).status).toBe(2);
    },
    E2E_TIMEOUT,
  );
});
