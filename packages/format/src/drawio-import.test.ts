import { describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from './base64.js';
import { deflateRaw } from './deflate.js';
import { drawioLibraryWork, importDrawioLibrary } from './drawio-import.js';
import type { SvgPaintRequest, SvgPaintWitness } from './svg-import.js';
import { encodeUtf8 } from './utf8.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const FILES = import.meta.glob('../../../specs/import/corpus/drawio/*.xml', { query: '?raw', import: 'default', eager: true });
const corpus = (name: string) => FILES[`../../../specs/import/corpus/drawio/${name}`] ?? '';

// Pure orchestration port, not evidence of actual host paint; M18.15/E2E owns that qualification.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });
const font = { family: 'Roboto', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
const options = { witness, namespace: 'drawio', fonts: [font], defaultFont: font.sha256 };
/** The test witness, counting its calls: a refused amplifying entry must never reach it (M18.237). */
const counted = () => {
  let n = 0;
  const counting: SvgPaintWitness = async (r) => {
    n += 1;
    return witness(r);
  };
  return { witness: counting, calls: () => n };
};
const library = (rows: unknown[]) => `<mxlibrary>${JSON.stringify(rows).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</mxlibrary>`;
const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const box = (id: string, style: string, value = '') =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;
const compressed = (xml: string) => {
  const packed = deflateRaw(encodeUtf8(encodeURIComponent(xml)));
  return encodeBase64(packed);
};
const text = (r: SvgPaintRequest): string => JSON.stringify(r.artwork.root);

// review r2 F1/F2: label chains recursed per link (stack overflow) and doubled terminals re-routed exponentially
const label = (id: string, edge: string) =>
  `<mxCell id="${id}" style="text" vertex="1" parent="${edge}"><mxGeometry x="0" y="0" width="4" height="4" relative="1" as="geometry"/></mxCell>`;
const edgeCell = (id: string, source: string, target: string) =>
  `<mxCell id="${id}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const chain = (links: number, doubled: boolean) => {
  let cells = box('v', 'rounded=0');
  for (let i = 0; i < links; i++) {
    const next = i + 1 < links;
    cells += edgeCell(`e${i}`, next ? `s${i + 1}` : 'v', next && doubled ? `t${i + 1}` : 'v');
    if (i > 0) cells += label(`s${i}`, `e${i}`) + (doubled ? label(`t${i}`, `e${i}`) : '');
  }
  return model(cells);
};

describe('draw.io library import (FR-LIB-006)', () => {
  it('FR-LIB-006: every pinned library imports at least 90 percent of its own entries, each with four anchors', async () => {
    for (const [name, entries] of [
      ['original-stencils.xml', 12],
      ['original-mixed.xml', 10],
      ['upstream-templates.xml', 12],
    ] as const) {
      const report = await importDrawioLibrary(corpus(name), options);
      expect(report.status, name).toBe('processed');
      if (report.status !== 'processed') continue;
      expect(report.entryCount, name).toBe(entries);
      expect(report.entries.map((e) => e.index)).toEqual([...Array(entries).keys()]);
      expect(report.acceptedCount / report.entryCount, name).toBeGreaterThanOrEqual(0.9);
      for (const e of report.entries) if (e.status === 'accepted') expect(e.value.definition.anchors?.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('FR-LIB-006: stencils keep their connection points and paint; models report external images as omissions', async () => {
    const stencils = await importDrawioLibrary(corpus('original-stencils.xml'), options);
    const rect = stencils.status === 'processed' ? stencils.entries[0] : undefined;
    expect(rect?.status === 'accepted' && rect.value.definition.anchors?.map((a) => [a.name, a.x, a.y])).toEqual([
      ['c1', 0.5, 0],
      ['c2', 1, 0.5],
      ['c3', 0.5, 1],
      ['c4', 0, 0.5],
    ]);
    const mixed = await importDrawioLibrary(corpus('original-mixed.xml'), options);
    expect(mixed.status === 'processed' && mixed.entries.map((e) => e.kind)).toEqual([
      ...['model', 'compressed-model', 'model', 'compressed-model', 'model', 'compressed-model', 'model', 'compressed-model'],
      'svg',
      'svg',
    ]);
    const templates = await importDrawioLibrary(corpus('upstream-templates.xml'), options);
    const network = templates.status === 'processed' ? templates.entries[4] : undefined;
    expect(network?.title).toBe('Network Diagram');
    expect(network?.status === 'accepted' && network.omissions).toEqual(expect.arrayContaining([expect.stringMatching(/^external-image-not-fetched/)]));
  });

  it('FR-LIB-006: labels, placeholders, compressed and edge-attached cells become checked text', async () => {
    const requests: SvgPaintRequest[] = [];
    const record: SvgPaintWitness = async (r) => {
      requests.push(r);
      return witness(r);
    };
    const xml = model(
      `<object label="%who% box" placeholders="1" who="Team" id="2"><mxCell style="rounded=1;fillColor=#123456;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></object>` +
        `<mxCell id="3" style="ellipse;html=1" value="a&lt;br&gt;b" vertex="1" parent="1"><mxGeometry x="200" width="40" height="40" as="geometry"/></mxCell>` +
        `<mxCell id="4" edge="1" source="2" target="3" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>` +
        `<mxCell id="5" value="yes" style="text" vertex="1" connectable="0" parent="4"><mxGeometry x="0" y="0" relative="1" as="geometry"/></mxCell>`,
    );
    const report = await importDrawioLibrary(
      library([
        { title: 'Plain', w: 1, h: 1, xml },
        { title: 'Plain', w: 1, h: 1, xml: compressed(xml) },
      ]),
      { ...options, witness: record },
    );
    expect(report.status === 'processed' && report.entries.map((e) => [e.id, e.status])).toEqual([
      ['drawio:plain', 'accepted'],
      ['drawio:plain-2', 'accepted'],
    ]);
    expect(text(requests[0] as SvgPaintRequest)).toBe(text(requests[1] as SvgPaintRequest));
    const paint = text(requests[0] as SvgPaintRequest);
    for (const fragment of ['Team box', '"a"', '"b"', '"yes"', '#123456', 'polyline', 'polygon']) expect(paint).toContain(fragment);
  });

  it('FR-LIB-006 NFR-SEC-001: hostile and unsupported entries are refused individually and stay in the denominator', async () => {
    const port = vi.fn(witness);
    const svg = (markup: string) => `data:image/svg+xml;base64,${encodeBase64(encodeUtf8(markup))}`;
    const rows = [
      { title: 'script', data: svg('<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="9" height="9"/></svg>') },
      { title: 'png', data: 'data:image/png;base64,AAAA' },
      { title: 'stencil ref', xml: model(box('2', 'shape=mxgraph.aws4.lambda')) },
      { title: 'entity', xml: '<!DOCTYPE x [<!ENTITY e "boom">]><mxGraphModel><root/></mxGraphModel>' },
      { title: 'bomb', xml: encodeBase64(deflateRaw(new Uint8Array(3 * 1024 * 1024))) },
      { title: 'handler', xml: model(box('2', 'html=1;onclick=alert(1);fillColor=javascript:alert(1)', '&lt;img src=x onerror=alert(1)&gt;')) },
      { title: 'external', xml: model(box('2', 'image;image=https://example.com/x.png')) },
      { title: 'nothing' },
      // review r1 F1: an edge label anchoring its own edge used to recurse until the stack overflowed
      {
        title: 'cycle',
        xml: model(
          `${box('2', 'rounded=0')}<mxCell id="4" edge="1" parent="1" source="5" target="2"><mxGeometry relative="1" as="geometry"/></mxCell>` +
            '<mxCell id="5" value="x" style="text" vertex="1" parent="4"><mxGeometry x="0" y="0" relative="1" as="geometry"/></mxCell>',
        ),
      },
    ];
    const report = await importDrawioLibrary(library(rows), { ...options, witness: port });
    expect(report.status).toBe('processed');
    if (report.status !== 'processed') return;
    expect(report.entryCount).toBe(rows.length);
    expect(report.entries.map((e) => e.status)).toEqual(['refused', 'refused', 'refused', 'refused', 'refused', 'accepted', 'accepted', 'refused', 'refused']);
    expect(report.entries[8]?.status === 'refused' && report.entries[8].diagnostics[0]?.message).toMatch(/anchors its own edge/);
    // a style is data: the handler entry draws a default-filled box with its tag stripped from the label
    expect(port.mock.calls.map(([r]) => text(r)).join()).not.toMatch(/alert|onerror|onclick|javascript|example\.com/);
    expect(report.entries[6]?.status === 'accepted' && report.entries[6].omissions).toEqual(['external-image-not-fetched: cell 2']);
  });

  it('FR-LIB-006 NFR-SEC-001: edges anchored on edge labels route once each and nest at most 32 deep', { timeout: 5000 }, async () => {
    const report = await importDrawioLibrary(
      library([
        { title: 'doubled', xml: chain(30, true) },
        // twice the 32 cap is enough to be refused by it; 2000 links only added parsing (M18.241: 2730 and 3013 ms of 5000 on darwin)
        { title: 'deep', xml: chain(64, false) },
        { title: 'ok', xml: model(box('2', 'rounded=0')) },
      ]),
      options,
    );
    expect(report.status === 'processed' && report.entries.map((e) => e.status)).toEqual(['accepted', 'refused', 'accepted']);
    expect(report.status === 'processed' && report.entries[1]?.status === 'refused' && report.entries[1].diagnostics[0]?.message).toMatch(
      /nest deeper than 32/,
    );
  });

  it('FR-LIB-006 NFR-SEC-001: decoded entries share a 16 Mi library work budget', async () => {
    // review r3 F1: every entry was bounded but the library was not (4096 x 2 MiB of inflation)
    const padded = compressed(`<mxGraphModel><root/>${'A'.repeat(1536 * 1024)}</mxGraphModel>`);
    const rows = [...Array.from({ length: 12 }, () => ({ title: 'padded', xml: padded })), { title: 'late', xml: model(box('2', 'rounded=0')) }];
    const report = await importDrawioLibrary(library(rows), options);
    expect(report.status).toBe('processed');
    if (report.status !== 'processed') return;
    const messages = report.entries.map((e) => (e.status === 'refused' ? (e.diagnostics[0]?.message ?? '') : 'accepted'));
    const limited = messages.map((m) => m.startsWith('library-work-limit'));
    // 1.5 Mi characters each: the first ten fit in 16 Mi, the eleventh overruns, every later entry is refused unread
    expect(limited).toEqual([...Array(10).fill(false), true, true, true]);
    expect(report.entryCount).toBe(rows.length);
  });

  it('FR-LIB-006 NFR-SEC-001: once one route walk spends the step budget, later walks are refused before they are converted (M18.222)', async () => {
    // the bound is the library's step budget, not a wall clock (cp32 F1): the first walk overruns it while painting, and every
    // later entry meets the spent budget before conversion, so a library of n walks converts one (unbounded: n)
    const points = `<Array as="points">${Array.from({ length: 5000 }, (_, i) => `<mxPoint x="${i}" y="0"/>`).join('')}</Array>`;
    const labels = Array.from(
      { length: 3500 },
      (_, i) =>
        `<mxCell id="l${i}" value="x" style="text" vertex="1" parent="e"><mxGeometry x="0" y="0" width="4" height="4" relative="1" as="geometry"/></mxCell>`,
    ).join('');
    const walk = {
      title: 'walk',
      xml: model(
        `${box('v', 'rounded=0')}<mxCell id="e" edge="1" parent="1" source="v" target="v"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>${labels}`,
      ),
    };
    const report = await importDrawioLibrary(library([walk, walk, walk, walk]), options);
    const reasons = report.status === 'processed' ? report.entries.map((e) => (e.status === 'refused' ? (e.diagnostics[0]?.message ?? '') : 'accepted')) : [];
    // the walk's own refusal comes from painting; the pre-conversion check names both budgets
    expect(reasons).toEqual([
      expect.stringMatching(/conversion steps exhausted$/),
      ...Array(3).fill(expect.stringMatching(/^library-work-limit: .* or the step budget$/)),
    ]);
  });

  // M18.237 (cp35 F1): each amplifying entry's bound is asserted by what it charged to the library budget and by the witness
  // never being called, not by elapsed time; the 10 s timeout is only an outer guard. The route walk, which spends the whole
  // step budget, is its own case below.
  it('FR-LIB-006 NFR-SEC-001: amplifying entries are refused while converting, in bounded time', { timeout: 10_000 }, async () => {
    // diagnostic review after r3: output, labels, placeholders, dashes, anchors and route walks were each unbounded
    const many = (n: number, unit: string) => unit.repeat(n);
    const wrapper = `<object label="${many(100, '%k%')}" placeholders="1" k="${many(100, 'ab')}" id="2"><mxCell style="rounded=0" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></object>`;
    const rows = [
      { title: 'lines', xml: model(box('2', 'rounded=0', many(100, 'a&#10;'))) },
      { title: 'placeholders', xml: model(wrapper) },
      { title: 'unclosed tags', xml: model(box('2', 'html=1', many(60_000, '&lt;'))) },
    ];
    const painted = counted();
    const { report, work } = await drawioLibraryWork(library(rows), { ...options, witness: painted.witness });
    const reasons = report.status === 'processed' ? report.entries.map((e) => (e.status === 'refused' ? (e.diagnostics[0]?.message ?? '') : 'accepted')) : [];
    expect(reasons).toHaveLength(rows.length);
    for (const [i, pattern] of [/exceeds 64 lines/, /resolved label exceeds 4096/, /label exceeds 4096/].entries())
      expect(reasons[i], rows[i]?.title).toMatch(pattern);
    // no entry reaches the witness, and none charges more characters than its own source: nothing is amplified
    expect(painted.calls()).toBe(0);
    for (const [i, row] of rows.entries()) expect(work[i]?.chars, row.title).toBeLessThanOrEqual(JSON.stringify(row).length);
    // labels stop at their caps after a few steps; the placeholders stop before all 100 lookups
    expect(work.slice(0, 3).map((w) => w.steps <= 64)).toEqual([true, true, true]);
    expect(work[1]?.steps).toBeLessThan(100);
    // nothing is made for any of them: no SVG written, no label line rendered (r2 F2); an ordinary two-line label makes some
    expect(work.map((w) => w.made)).toEqual([0, 0, 0]);
    const control = await drawioLibraryWork(library([{ title: 'two lines', xml: model(box('2', 'rounded=0', 'a&#10;b')) }]), options);
    expect(control.work[0]?.made).toBeGreaterThan(0);
  });

  // M18.241: the embedded SVG and the stencils were the amplifying case's own work (6699 ms of 10000 on darwin at f0805eb)
  it('FR-LIB-006 NFR-SEC-001: an embedded SVG over 2 Mi characters is refused by its size before any decoding (M18.241)', { timeout: 10_000 }, async () => {
    // the cap is 2 Mi decoded bytes as base64 plus 64 characters of data URL; one base64 quantum over it is enough
    const cap = Math.ceil((2 * 1024 * 1024 * 4) / 3) + 64;
    const row = { title: 'svg data', data: `data:image/svg+xml;base64,${'A'.repeat(cap + 4)}` };
    const painted = counted();
    const { report, work } = await drawioLibraryWork(library([row]), { ...options, witness: painted.witness });
    expect(report.status === 'processed' && report.entries[0]?.status === 'refused' && report.entries[0].diagnostics[0]?.message).toMatch(
      /embedded SVG exceeds/,
    );
    expect(painted.calls()).toBe(0);
    expect(work[0]).toEqual({ chars: 0, steps: 0, made: 0 });
  });

  it('FR-LIB-006 NFR-SEC-001: amplifying stencils are refused at their caps before their work (M18.241)', { timeout: 10_000 }, async () => {
    const many = (n: number, unit: string) => unit.repeat(n);
    const stencil = (inner: string) => `<shapes><shape name="s" w="10" h="10">${inner}</shape></shapes>`;
    const dash = `<foreground><dashpattern pattern="${many(17, '1 ').trim()}"/><dashed dashed="1"/><rect x="0" y="0" w="10" h="10"/><stroke/></foreground>`;
    const anchors = `<connections>${many(257, '<constraint x="0.5" y="0.5"/>')}</connections><foreground><rect x="0" y="0" w="10" h="10"/><fillstroke/></foreground>`;
    const text = `<foreground><text str="${many(5000, 'a&#10;')}" x="5" y="5"/></foreground>`;
    const anchorsPattern = /exceeds 256 connection points/;
    for (const [inner, pattern] of [
      [dash, /dash pattern exceeds 16/],
      [anchors, anchorsPattern],
      [text, /label exceeds 4096/],
    ] as const) {
      const source = stencil(inner);
      const stencilPainted = counted();
      const {
        report: r,
        work: [spent],
      } = await drawioLibraryWork(source, { ...options, witness: stencilPainted.witness });
      expect(r.status === 'processed' && r.entries[0]?.status === 'refused' && r.entries[0].diagnostics[0]?.message).toMatch(pattern);
      // refused at its cap before the dashes, points or lines are written out: no witness, no steps, no more characters than its source
      expect(stencilPainted.calls()).toBe(0);
      expect(spent?.steps, String(pattern)).toBe(0);
      expect(spent?.chars, String(pattern)).toBeLessThanOrEqual(source.length);
      // refused at its cap before any dash value, anchor or label line is made (r2 F1); the anchors' stencil has already
      // written its rectangle, which is less than one unit per refused constraint
      expect(spent?.made, String(pattern)).toBeLessThan(pattern === anchorsPattern ? 257 : 1);
    }
  });

  it('FR-LIB-006 NFR-SEC-001: a route walk is refused once it spends the library step budget (M18.237)', { timeout: 10_000 }, async () => {
    const points = `<Array as="points">${Array.from({ length: 5000 }, (_, i) => `<mxPoint x="${i}" y="0"/>`).join('')}</Array>`;
    const labels = Array.from(
      { length: 3500 },
      (_, i) =>
        `<mxCell id="l${i}" value="x" style="text" vertex="1" parent="e"><mxGeometry x="0" y="0" width="4" height="4" relative="1" as="geometry"/></mxCell>`,
    ).join('');
    const walked = `${box('v', 'rounded=0')}<mxCell id="e" edge="1" parent="1" source="v" target="v"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>${labels}`;
    const row = { title: 'route walks', xml: model(walked) };
    const painted = counted();
    const { report, work } = await drawioLibraryWork(library([row]), { ...options, witness: painted.witness });
    const reasons = report.status === 'processed' ? report.entries.map((e) => (e.status === 'refused' ? (e.diagnostics[0]?.message ?? '') : 'accepted')) : [];
    expect(reasons).toEqual([expect.stringMatching(/conversion steps exhausted/)]);
    expect(painted.calls()).toBe(0);
    // the walk is refused by the step budget (16 Mi steps), overrunning it by less than one route's points
    expect(work[0]?.steps).toBeGreaterThan(16 * 1024 * 1024);
    expect(work[0]?.steps).toBeLessThanOrEqual(16 * 1024 * 1024 + 5000);
    expect(work[0]?.chars).toBeLessThanOrEqual(JSON.stringify(row).length);
  });

  it('FR-LIB-006: equal titles number in order and references decode in linear time', { timeout: 10_000 }, async () => {
    const same = await importDrawioLibrary(library(Array.from({ length: 4096 }, () => ({ title: 'same' }))), options);
    expect(same.status === 'processed' && [same.entries[0]?.id, same.entries[1]?.id, same.entries[4095]?.id]).toEqual([
      'drawio:same',
      'drawio:same-2',
      'drawio:same-4096',
    ]);
    const name = `A&amp;B${'&#32;'.repeat(400_000)}&#x43;`;
    const decoded = await importDrawioLibrary(
      `<shapes><shape name="${name}" w="10" h="10"><foreground><rect x="0" y="0" w="10" h="10"/><fillstroke/></foreground></shape></shapes>`,
      options,
    );
    expect(decoded.status === 'processed' && decoded.entries[0]?.title).toBe(`A&B${' '.repeat(400_000)}C`);
  });

  // M18.19 review r4 F1–F3 (M18.104)
  it('FR-LIB-006 NFR-SEC-001: an element with more than 256 attributes is refused; 256 still read', async () => {
    // name, w and h plus `count` more
    const attrs = (count: number) => Array.from({ length: count }, (_, i) => ` a${i}="1"`).join('');
    const shapes = (count: number) =>
      `<shapes><shape name="s" w="10" h="10"${attrs(count)}><foreground><rect x="0" y="0" w="10" h="10"/><fillstroke/></foreground></shape></shapes>`;
    expect((await importDrawioLibrary(shapes(253), options)).status).toBe('processed');
    expect((await importDrawioLibrary(shapes(254), options)).status).toBe('failed');
  });

  it('FR-LIB-006: stencil text that loses non-ASCII characters is reported as an omission', async () => {
    const stencil = (str: string) =>
      `<shapes><shape name="t" w="40" h="20"><foreground><rect x="0" y="0" w="40" h="20"/><fillstroke/><text str="${str}" x="20" y="10"/></foreground></shape></shapes>`;
    const accented = await importDrawioLibrary(stencil('Café'), options);
    const entry = accented.status === 'processed' ? accented.entries[0] : undefined;
    expect(entry?.status === 'accepted' && entry.omissions).toEqual(['non-ascii-label-characters-replaced: 1 stencil text']);
    const plain = await importDrawioLibrary(stencil('Cafe'), options);
    const kept = plain.status === 'processed' ? plain.entries[0] : undefined;
    expect(kept?.status === 'accepted' && kept.omissions).toEqual([]);
  });

  it('FR-LIB-006 NFR-SEC-001: style values look up only the tables’ own keys', async () => {
    // `toString` and `__proto__` are inherited names, not a direction or a label position: they fall back to the defaults
    const xml = model(
      box('a', 'triangle;direction=toString') + box('b', 'text;labelPosition=toString;verticalLabelPosition=__proto__', 'Hi') + box('c', 'triangle'),
    );
    const done = await importDrawioLibrary(library([{ xml, w: 300, h: 60, title: 'own keys' }]), options);
    const entry = done.status === 'processed' ? done.entries[0] : undefined;
    expect(entry?.status).toBe('accepted');
    const svg = entry?.status === 'accepted' ? entry.value.definition : undefined;
    expect(JSON.stringify(svg)).not.toMatch(/NaN|undefined/);
  });

  it('FR-LIB-006 NFR-SEC-001: malformed, empty, entity-bearing or oversized libraries fail before conversion', async () => {
    const port = vi.fn(witness);
    for (const input of [
      '',
      '<mxlibrary>[]</mxlibrary>',
      '<shapes name="x"></shapes>',
      '<mxlibrary>{"a":1}</mxlibrary>',
      '<!DOCTYPE mxlibrary [<!ENTITY e "x">]><mxlibrary>[]</mxlibrary>',
      '<mxlibrary>[&e;]</mxlibrary>',
      '<mxlibrary>[]',
      '<svg/>',
      `<mxlibrary>${JSON.stringify(Array.from({ length: 4097 }, () => ({})))}</mxlibrary>`,
      // bounded before JSON.parse (diagnostic review): deep nesting and huge row arrays never reach the parser
      `<mxlibrary>${'['.repeat(100_000)}</mxlibrary>`,
      `<mxlibrary>[${'{},'.repeat(1_000_000)}{}]</mxlibrary>`,
    ])
      expect((await importDrawioLibrary(input, { ...options, witness: port })).status, input.slice(0, 40)).toBe('failed');
    expect((await importDrawioLibrary(corpus('original-mixed.xml'), { ...options, namespace: 'Bad' })).status).toBe('failed');
    expect(port).not.toHaveBeenCalled();
  });
});
