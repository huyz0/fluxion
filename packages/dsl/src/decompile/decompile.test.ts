import { idKeys, sha256Hash128, stableId } from '@fluxion/core';
import { type AnyRecord, type DocumentFile, type RecordId, serializeDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { CHECKOUT } from '../read/checkout.fixture.js';
import type { CompileOptions } from '../types.js';
import { decompile, decompileScreen } from './decompile.js';
import { registries } from './registries.fixture.js';

const build = (text: string, options: Partial<CompileOptions> = {}): DocumentFile => {
  const r = compile(text, { registries: registries(), ...options });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.doc as DocumentFile;
};
const back = (doc: DocumentFile) => decompile(doc, { registries: registries() });
const bytes = (doc: DocumentFile) => serializeDocument(doc);
const id = (key: string, salt = '') => stableId(sha256Hash128, salt, key) as RecordId;
const doc = (body: string, head = 'uses: [basic]\n') => `flux: 1\ntitle: Checkout\n${head}screens:\n${body}`;
const deferredOf = (d: DocumentFile) =>
  (Object.values(d.records).find((r) => r.type === 'document') as unknown as { source: { deferred: object } }).source.deferred;

/** `doc` with `records` added. */
const withRecords = (d: DocumentFile, ...records: AnyRecord[]): DocumentFile => ({
  ...d,
  records: { ...d.records, ...Object.fromEntries(records.map((r) => [r.id, r])) },
});
const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const box = { x: 0, y: 0, w: 100, h: 50 };

describe('decompile', () => {
  it('FR-DSL-002: the checkout example round-trips: compile(decompile(doc)) is the same document, deferred sections kept in place', () => {
    const first = build(CHECKOUT);
    const { text, kept } = back(first);
    const again = build(text);
    expect(bytes(again)).toBe(bytes(first));
    expect(deferredOf(again)).toEqual(deferredOf(first));
    expect(Object.keys(deferredOf(first))).toHaveLength(11);
    expect(kept).toBe(0);
    // canonical, readable FluxScript: flow nodes, short shape names, edge shorthand, pins only where pinned
    expect(text).toContain('theme: { preset: ocean, accent: "#7C5CFF", mode: auto }\nuses: [basic, flowchart]\n');
    expect(text).toContain('      db: { shape: database, label: Orders DB, alt: Orders database }\n');
    expect(text).toContain('      queue: { shape: queue, label: Events, pin: { x: 1500, y: 820 } }\n');
    expect(text).toContain('      backend: { label: Backend, contains: [api, pay, db], style: dashed }\n');
    expect(text).toContain('      - web -> api: HTTPS\n      - api -> pay: charge()\n      - api -> db\n      - pay ~> queue: { label: event, flow: dots }\n');
    expect(text.match(/pin:/g)).toHaveLength(1);
    // deferred sections written back where they were
    expect(text).toContain('      web: { shape: rounded-rect, label: Web, icon: lucide:globe }\n');
    expect(text).toContain('    steps:\n      - show: [web, api]\n');
    expect(text).toContain('  - id: intro\n    kind: title ');
    // deterministic
    expect(back(first).text).toBe(text);
  });

  it('FR-DSL-002: a recompile into the document keeps its ids: the salt stays in document.source (ADR-0031)', () => {
    const first = build(CHECKOUT, { salt: 's1' });
    expect(first.records[id('node:api', 's1')]).toBeDefined();
    const again = build(back(first).text, { base: first });
    expect(bytes(again)).toBe(bytes(first));
  });

  it('FR-DSL-002: edges keep their op, anchors, labels, routes, styles and repeats', () => {
    const src = doc(
      `  - id: a
    title: Edges
    layout: { type: stack, gap: 12 }
    background: color.surface
    notes: "Two lines:\\nsecond"
    nodes:
      x: { shape: basic:rect, label: X, style: { fill: color.primary, stroke.width: 3 } }
      y: { text: "Plain: text", tone: muted }
      d: { shape: database }
    groups:
      g: { contains: [y], style: { variant: card } }
    edges:
      - x.e -> y.w: { label: go, route: orthogonal }
      - x <-> y
      - x -- g
      - y <- x
      - x -> y: { style: dashed }
      - x -> y
      - x ~> y: { style: solid }
      - { from: x.named-1, to: y, op: "~>", style: { stroke.width: 4 } }
`,
      'uses: [basic, flowchart]\n',
    );
    const first = build(src);
    const { text } = back(first);
    expect(bytes(build(text))).toBe(bytes(first));
    expect(text).toContain('      x: { shape: basic:rect, label: X, style: { fill: color.primary, stroke.width: 3 } }\n');
    expect(text).toContain('      y: { text: "Plain: text", tone: muted }\n');
    expect(text).toContain('      - x.e -> y.w: { label: go, route: orthogonal }\n');
    expect(text).toContain('      - x -> y: { style: dashed }\n      - x -> y\n      - x ~> y: { style: solid }\n');
    expect(text).toContain('      - x.named-1 ~> y: { style: { stroke.width: 4 } }\n');
    expect(text).toContain('    notes: "Two lines:\\nsecond"\n');
  });

  it('FR-DSL-002: theme overrides that differ from the registered theme are written back', () => {
    const first = build(doc('  - id: a\n', 'theme: { preset: ocean, overrides: { color.primary: "#123456", space.md: 20px, motion.duration.fast: 200 } }\n'));
    const { text } = back(first);
    expect(text).toContain('theme: { preset: ocean, overrides: { color.primary: "#123456", space.md: 20, motion.duration.fast: 200 } }\n');
    expect(bytes(build(text))).toBe(bytes(first));
    // the built-in light theme, unnamed, is left out
    expect(back(build(doc('  - id: a\n'))).text).not.toContain('theme:');
  });

  it('FR-DSL-002: a hand-made element without a slug gets one from its label, unique in the document', () => {
    const first = build(doc('  - id: a\n    nodes:\n      api: { shape: rect, label: API }\n'));
    const screenId = id(idKeys.screen('a'));
    const made = (rid: string, label: string, index: string) =>
      ({
        id: rid,
        type: 'element',
        kind: 'shape',
        defId: 'basic:rect',
        screenId,
        index,
        text: para(label),
        placement: 'auto',
        transform: box,
      }) as unknown as AnyRecord;
    const edited = withRecords(
      first,
      made('handMade00000001', 'Cache Layer', 'a5'),
      made('handMade00000002', 'Cache Layer', 'a6'),
      made('handMade00000003', 'API', 'a7'),
    );
    const { text, slugs } = back(edited);
    expect(slugs.get('handMade00000001' as RecordId)).toBe('cache-layer');
    expect(slugs.get('handMade00000002' as RecordId)).toBe('cache-layer-2');
    // `api` is taken by the compiled node, which keeps it
    expect(slugs.get('handMade00000003' as RecordId)).toBe('api-2');
    expect(slugs.get(id('node:api'))).toBe('api');
    expect(text).toContain('      cache-layer: { shape: rect, text: Cache Layer }\n      cache-layer-2: { shape: rect, text: Cache Layer }\n');
    const again = build(text);
    expect(again.records[id('node:cache-layer-2')]).toBeDefined();
  });

  it('FR-DSL-002: records outside the v0 subset are counted in # kept, and edges to them are kept too', () => {
    const first = build(doc('  - id: a\n    nodes:\n      api: { shape: rect, label: API }\n'));
    const screenId = id(idKeys.screen('a'));
    const image = { id: 'image00000000001', type: 'element', kind: 'image', screenId, index: 'a5', placement: 'auto', transform: box, src: 'res:1' };
    const bold = {
      id: 'boldText00000001',
      type: 'element',
      kind: 'text',
      screenId,
      index: 'a6',
      placement: 'auto',
      transform: box,
      text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] }] }] },
    };
    const link = { id: 'connector0000001', type: 'element', kind: 'connector', screenId, index: 'a7', route: { type: 'straight' } };
    const ends = ['source', 'target'].map((end, i) => ({
      id: `binding000000000${i}`,
      type: 'binding',
      connectorId: link.id,
      end,
      elementId: i === 0 ? id('node:api') : image.id,
      anchor: { kind: 'auto' },
    }));
    const section = { id: 'section000000001', type: 'section', name: 'Part one' };
    const edited = withRecords(first, ...([image, bold, link, ...ends, section] as unknown as AnyRecord[]));
    const r = back(edited);
    expect(r.kept).toBe(4);
    expect(r.text).toContain('      api: { shape: rect, label: API }\n    # kept: 3 records not shown\n');
    expect(r.text.endsWith('# kept: 1 records not shown\n')).toBe(true);
    expect(r.text).not.toContain('Hi');
    expect(bytes(build(r.text))).toBe(bytes(first));
  });

  it('FR-DSL-002: an edge drawn by hand is searched only among the edges joining its two ends, so hashes grow with the edges, not their square', () => {
    const slugs = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const first = build(doc(`  - id: a\n    nodes:\n${slugs.map((n) => `      ${n}: { shape: rect }\n`).join('')}`));
    const screenId = id(idKeys.screen('a'));
    // 40 connectors with random-looking ids over 9 pairs of neighbours: about 4 to 5 per pair
    const drawn = Array.from({ length: 40 }, (_, k) => {
      const link = {
        id: `drawn${String(k).padStart(11, '0')}`,
        type: 'element',
        kind: 'connector',
        screenId,
        index: `b${String(k).padStart(2, '0')}`,
        route: { type: 'straight' },
        markers: { end: 'arrow' },
      };
      const ends = ['source', 'target'].map((end, i) => ({
        id: `bind${String(k).padStart(10, '0')}${i}`,
        type: 'binding',
        connectorId: link.id,
        end,
        elementId: id(`node:n${(k % 9) + i}`),
        anchor: { kind: 'auto' },
      }));
      return [link, ...ends];
    });
    let hashes = 0;
    const hasher = { hash128: (text: string) => (hashes++, sha256Hash128.hash128(text)) };
    const r = decompile(withRecords(first, ...(drawn.flat() as unknown as AnyRecord[])), { registries: registries(), hasher });
    expect(r.text.match(/ -> /g)).toHaveLength(40);
    // two ops for an end arrow, times the edges joining the same ends (at most 5), for each edge
    expect(hashes).toBeLessThanOrEqual(40 * 2 * 5);
  });

  it('FR-DSL-002: a deferred block written with other indentation is re-indented to fit, and means the same', () => {
    const src =
      'flux: 1\ntitle: T\nvars:\n    brand:\n        name: Acme\nscreens:\n- id: a\n  steps:\n  - show: [x]\n  - effect: fade\n  markdown: |\n   **Hi**\n'.replace(
        'markdown',
        'mermaid',
      );
    const first = build(src);
    const { text } = back(first);
    expect(text).toContain('vars:\n  brand:\n    name: Acme\n');
    expect(text).toContain('    mermaid: |\n      **Hi**\n    steps:\n      - show: [x]\n      - effect: fade\n');
    const again = build(text);
    expect(deferredOf(again)).toEqual({
      '/vars': 'brand:\n    name: Acme\n',
      '/screens/a/steps': '- show: [x]\n      - effect: fade\n',
      '/screens/a/mermaid': '|\n      **Hi**\n',
    });
    // from then on the text is a fixed point
    expect(back(again).text).toBe(text);
  });

  it('FR-DSL-002: decompileScreen writes one screen item; screens limits a whole decompile to some screens', () => {
    const first = build(CHECKOUT);
    const arch = id(idKeys.screen('arch'));
    const one = decompileScreen(first, arch, { registries: registries() });
    expect(one.text.startsWith('- id: arch\n  title: Architecture\n')).toBe(true);
    expect(one.text).toContain('\n  steps:\n    - show: [web, api]\n');
    expect(decompileScreen(first, 'nope' as RecordId, { registries: registries() }).text).toBe('');
    const some = decompile(first, { registries: registries(), screens: [arch] }).text;
    expect(some).toContain('  - id: arch\n');
    expect(some).not.toContain('id: intro');
  });
});
