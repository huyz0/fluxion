import { expect, it, vi } from 'vitest';
import { importSvgShape, type SvgPaintWitness } from './svg-import.js';

const witness: SvgPaintWitness = async (request) => ({ identity: request.identity, status: 'painted', fontHashes: request.fonts.map((f) => f.sha256) });
const options = { id: 'sample:imported', witness };
const rect = '<svg viewBox="0 0 100 50"><rect x="10" y="5" width="80" height="40" fill="red"/></svg>';

it('FR-LIB-004: imports an exact simple rectangle with scalable outline and four anchors', async () => {
  const result = await importSvgShape(rect, options);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.definition.defaultSize).toEqual({ w: 100, h: 50 });
  expect(result.value.definition.outline).toEqual({ path: 'M {w*0.1} {h*0.1} L {w*0.9} {h*0.1} L {w*0.9} {h*0.9} L {w*0.1} {h*0.9} Z' });
  expect(result.value.definition.anchors?.map(({ x, y }) => [x, y])).toEqual([
    [0.5, 0.1],
    [0.9, 0.5],
    [0.5, 0.9],
    [0.1, 0.5],
  ]);
  expect(result.value.diagnostics).toEqual([]);
});

it('FR-LIB-004: preserves native nonzero viewport and source paint while diagnosing routing fallback', async () => {
  const result = await importSvgShape(
    '<svg width="200" height="100" viewBox="10 20 100 100" preserveAspectRatio="none"><circle cx="50" cy="50" r="20"/></svg>',
    options,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.definition.artwork?.viewBox).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  expect(result.value.definition.artwork?.root.attributes['viewBox']).toBe('10 20 100 100');
  expect(result.value.definition.artwork?.root.attributes['preserveAspectRatio']).toBe('none');
  expect(result.value.definition.anchors).toHaveLength(4);
  expect(result.value.diagnostics).toEqual([
    expect.objectContaining({ code: 'FLX_SVG_OUTLINE_FALLBACK', severity: 'warning', message: expect.stringContaining('viewport-clipped') }),
  ]);
});

it('NFR-SEC-001 FR-LIB-004: hostile, semantically invalid and unsupported viewports never reach the witness', async () => {
  const port = vi.fn(witness);
  for (const input of [
    '<svg viewBox="0 0 10 10"><script>x()</script></svg>',
    '<svg viewBox="0 0 10 10"><use href="#missing"/></svg>',
    '<svg width="20%" height="10"><rect/></svg>',
    '<svg viewBox="0 0 0 10"/>',
  ]) {
    expect((await importSvgShape(input, { ...options, witness: port })).ok).toBe(false);
  }
  expect(port).not.toHaveBeenCalled();
});

it('FR-LIB-004: no visible paint, mismatched identity and failed ports are errors rather than imported counts', async () => {
  for (const port of [
    async (request: Parameters<SvgPaintWitness>[0]) => ({ identity: request.identity, status: 'no-witness' as const, fontHashes: [] }),
    async () => ({ identity: 'wrong', status: 'painted' as const, fontHashes: [] }),
    async () => {
      throw new Error('missing renderer');
    },
  ])
    expect((await importSvgShape(rect, { ...options, witness: port })).ok).toBe(false);
});

it('FR-LIB-004: text requires declared exact font capability and receipt; it is not inferred from a filename', async () => {
  const input = '<svg viewBox="0 0 100 50"><text x="10" y="30">API</text></svg>';
  expect((await importSvgShape(input, options)).ok).toBe(false);
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
  const result = await importSvgShape(input, { ...options, fonts: [face], defaultFont: face.sha256 });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.fonts).toEqual([face]);
    expect(result.value.definition.artwork?.root.attributes['font-family']).toBe('Inter');
  }
  expect(
    (
      await importSvgShape(input, {
        ...options,
        fonts: [face],
        defaultFont: face.sha256,
        witness: async (r) => ({ identity: r.identity, status: 'painted', fontHashes: [] }),
      })
    ).ok,
  ).toBe(false);
});

it('FR-LIB-004: color mappings only refer to explicitly existing tokens', async () => {
  const colors = { red: '{color.accent}' as const };
  expect((await importSvgShape(rect, { ...options, colors, tokenRefs: new Set() })).ok).toBe(false);
  const result = await importSvgShape(rect, { ...options, colors, tokenRefs: new Set(['{color.accent}']) });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.definition.artwork?.colors).toEqual(colors);
});

it('FR-LIB-004 NFR-SEC-001: tiny finite viewports still request a finite bounded raster', async () => {
  const port = vi.fn(witness);
  const result = await importSvgShape('<svg viewBox="0 0 1e-307 1e-307"><rect width="1e-307" height="1e-307"/></svg>', { ...options, witness: port });
  expect(result.ok).toBe(true);
  expect(port.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ width: 1024, height: 1024 }));
});

it('FR-LIB-004: witness mutations cannot change the returned validated definition', async () => {
  const result = await importSvgShape(rect, {
    ...options,
    witness: async (request) => {
      (request.artwork.root.attributes as Record<string, string>)['onload'] = 'host mutation';
      return witness(request);
    },
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.definition.artwork?.root.attributes).not.toHaveProperty('onload');
});

it('FR-LIB-004: percentage source geometry and one-dimension aspect ratio remain native', async () => {
  const result = await importSvgShape('<svg width="200" viewBox="10 20 100 50"><rect width="100%" height="100%"/></svg>', options);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.definition.defaultSize).toEqual({ w: 200, h: 100 });
    expect(result.value.definition.artwork?.root.children[0]).toEqual(expect.objectContaining({ attributes: { width: '100%', height: '100%' } }));
    expect(result.value.diagnostics[0]?.code).toBe('FLX_SVG_OUTLINE_FALLBACK');
  }
});

it('FR-LIB-004 NFR-SEC-001: unavailable faces and unsupported text profiles never reach paint', async () => {
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
  const port = vi.fn(witness);
  for (const text of [
    '<text font-family="Missing">API</text>',
    '<text font-weight="700">API</text>',
    '<text font-style="italic">API</text>',
    '<text x="1 2 3">API</text>',
    '<text textLength="30">API</text>',
    '<text><tspan>API</tspan></text>',
    '<text>日本語</text>',
  ])
    expect((await importSvgShape(`<svg viewBox="0 0 100 50">${text}</svg>`, { ...options, fonts: [face], defaultFont: face.sha256, witness: port })).ok).toBe(
      false,
    );
  expect(port).not.toHaveBeenCalled();
});

it('FR-LIB-004: authored style inheritance selects the exact available face', async () => {
  const face = { family: 'Inter', weight: 700, style: 'italic' as const, sha256: 'b'.repeat(64) };
  const result = await importSvgShape('<svg viewBox="0 0 100 50"><g style="font-family:Inter;font-weight:bold;font-style:italic"><text>API</text></g></svg>', {
    ...options,
    fonts: [face],
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.fonts).toEqual([face]);
});

it('FR-LIB-004: opacity, stroke, rounded corners and transformed rectangles are explicitly fallback routing', async () => {
  for (const attribute of ['opacity="0.5"', 'stroke="blue"', 'rx="5"', 'transform="translate(1 1)"']) {
    const result = await importSvgShape(`<svg viewBox="0 0 100 50"><rect width="80" height="40" ${attribute}/></svg>`, options);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.diagnostics[0]?.code).toBe('FLX_SVG_OUTLINE_FALLBACK');
  }
});

it('FR-LIB-004: text use-instance inheritance is refused rather than silently normalized from defs', async () => {
  const faces = [
    { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) },
    { family: 'Inter', weight: 700, style: 'normal' as const, sha256: 'b'.repeat(64) },
  ];
  const port = vi.fn(witness);
  for (const uses of ['<use href="#t" font-family="Missing"/>', '<use href="#t" font-weight="700"/>', '<use href="#t"/><use href="#t" font-weight="700"/>']) {
    const result = await importSvgShape(`<svg viewBox="0 0 100 50"><defs><text id="t">API</text></defs>${uses}</svg>`, {
      ...options,
      fonts: faces,
      defaultFont: 'a'.repeat(64),
      witness: port,
    });
    expect(result.ok).toBe(false);
  }
  expect(port).not.toHaveBeenCalled();
});

it('FR-LIB-004: grouped and chained text references are refused before normalization', async () => {
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
  const port = vi.fn(witness);
  for (const content of [
    '<defs><g id="g"><text>API</text></g></defs><use href="#g"/>',
    '<defs><symbol id="g"><text>API</text></symbol></defs><use href="#g"/>',
    '<defs><text id="t">API</text><g id="g"><use href="#t"/></g></defs><use href="#g"/>',
  ])
    expect(
      (await importSvgShape(`<svg viewBox="0 0 100 100">${content}</svg>`, { ...options, fonts: [face], defaultFont: face.sha256, witness: port })).ok,
    ).toBe(false);
  expect(port).not.toHaveBeenCalled();
});

it('FR-LIB-004: malformed or ambiguous font capability catalogs fail before rendering', async () => {
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
  const port = vi.fn(witness);
  for (const fonts of [[face, face], [{ ...face, weight: 0 }], [{ ...face, family: '' }], [{ ...face, sha256: 'bad' }], [{ ...face, weight: 400.5 }]]) {
    expect((await importSvgShape(rect, { ...options, fonts, witness: port })).ok).toBe(false);
  }
  expect((await importSvgShape(rect, { ...options, fonts: [face], defaultFont: 'b'.repeat(64), witness: port })).ok).toBe(false);
  expect(port).not.toHaveBeenCalled();
});

it('FR-LIB-004: all 50 frozen inputs produce bounded usable routing after a supplied witness', async () => {
  const corpus = Object.values(import.meta.glob('../../../specs/import/corpus/svg/*.svg', { query: '?raw', import: 'default', eager: true }));
  expect(corpus).toHaveLength(50);
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
  // This checks pure routing obligations only. Real witnesses/fidelity run in e2e/svg-import.spec.ts.
  for (const source of corpus) {
    const result = await importSvgShape(source, { ...options, fonts: [face], defaultFont: face.sha256 });
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    expect(result.value.definition.anchors?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(result.value.definition.defaultSize.w).toBeGreaterThan(0);
    expect(result.value.definition.defaultSize.h).toBeGreaterThan(0);
  }
});
