import type { SvgArtwork } from '@fluxion/schema';
import { expect, it, vi } from 'vitest';
import { importSvgShape } from './svg-import.js';
import type { SvgPaintRequest } from './svg-import-types.js';
import { createSvgPaintRequest, parseSvgPaintRequest } from './svg-paint-request.js';

const baselines = JSON.parse(
  Object.values(import.meta.glob('./__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as readonly { name: string; source: string; request: SvgPaintRequest }[];
expect(baselines).toHaveLength(5);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const baseline = (index = 0): SvgPaintRequest => {
  const sample = baselines[index];
  if (!sample) throw Error('missing baseline');
  return clone(sample.request);
};
for (const sample of baselines) {
  it(`FR-LIB-004: preserves existing ${sample.name} canonical request bytes and identity`, async () => {
    const request = sample.request as SvgPaintRequest;
    const built = createSvgPaintRequest(request.artwork, request.fonts);
    expect(built).toEqual({ ok: true, value: request });
    expect(parseSvgPaintRequest(request)).toEqual(built);
    let observed: SvgPaintRequest | undefined;
    const imported = await importSvgShape(sample.source, {
      id: 'test:baseline',
      fonts: request.fonts,
      ...(request.fonts[0] ? { defaultFont: request.fonts[0].sha256 } : {}),
      witness: async (r) => {
        observed = r;
        return { identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) };
      },
    });
    expect(imported.ok).toBe(true);
    expect(observed).toEqual(request);
  });
}
it('FR-LIB-004: rejects stale identities and every noncanonical raster rather than repairing it', () => {
  for (const change of [{ identity: '0'.repeat(64) }, { width: 1 }, { height: 1 }, { width: 1025 }, { height: Infinity }, { extra: true }])
    expect(parseSvgPaintRequest({ ...baseline(), ...change }).ok).toBe(false);
});
it('FR-LIB-004: rejects changed artwork even when its old identity and raster are retained', () => {
  const request = baseline();
  const artwork = { ...request.artwork, root: { ...request.artwork.root, attributes: { ...request.artwork.root.attributes, opacity: '0' } } };
  expect(parseSvgPaintRequest({ ...request, artwork }).ok).toBe(false);
});
it('NFR-SEC-001: rejects descriptor accessors and nonplain envelopes without executing them', () => {
  const getter = vi.fn(() => baseline().artwork);
  const request = Object.defineProperty(baseline(), 'artwork', { get: getter });
  expect(parseSvgPaintRequest(request).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(parseSvgPaintRequest(Object.assign(Object.create({}), baseline())).ok).toBe(false);
  expect(parseSvgPaintRequest(null).ok).toBe(false);
});
it('NFR-SEC-001: rejects cyclic, overdepth and oversized artwork before canonical serialization', () => {
  const cycle = baseline();
  (cycle.artwork.root.children as unknown[]).push(cycle.artwork.root);
  expect(parseSvgPaintRequest(cycle).ok).toBe(false);
  let root = baseline().artwork.root;
  for (let i = 0; i < 65; i++) root = { name: 'g', attributes: {}, children: [root] };
  expect(createSvgPaintRequest({ ...baseline().artwork, root }, []).ok).toBe(false);
  expect(createSvgPaintRequest({ ...baseline().artwork, root: { name: 'text', attributes: {}, children: ['x'.repeat(2 * 1024 * 1024 + 1)] } }, []).ok).toBe(
    false,
  );
});
it('NFR-SEC-001: hostile references and invalid viewports cannot obtain a canonical request', () => {
  const artwork = baseline().artwork;
  expect(createSvgPaintRequest({ ...artwork, root: { name: 'use', attributes: { href: 'https://invalid.example/x.svg' }, children: [] } }, []).ok).toBe(false);
  expect(createSvgPaintRequest({ ...artwork, viewBox: { ...artwork.viewBox, width: 0 } }, []).ok).toBe(false);
});
it('FR-LIB-004: requires exact normalized font closure, not missing, duplicate or unused faces', () => {
  const text = baseline(3);
  const face = text.fonts[0];
  if (!face) throw Error('missing baseline face');
  for (const fonts of [[], [face, face], [{ ...face, weight: 700 }], [{ ...face, family: 'other' }], [{ ...face, sha256: 'bad' }]])
    expect(createSvgPaintRequest(text.artwork, fonts).ok).toBe(false);
  expect(createSvgPaintRequest(baseline().artwork, [face]).ok).toBe(false);
  const unnormalized = clone(text.artwork);
  const label = unnormalized.root.children.find((n) => typeof n !== 'string' && n.name === 'text');
  if (!label || typeof label === 'string') throw Error('missing label');
  delete (label.attributes as Record<string, string>)['font-family'];
  expect(createSvgPaintRequest(unnormalized, text.fonts).ok).toBe(false);
});
it('NFR-SEC-001: font descriptors and arrays must be bounded plain data', () => {
  const request = baseline(3),
    face = request.fonts[0];
  const getter = vi.fn(() => face?.family);
  const bad = Object.defineProperty({ ...face }, 'family', { get: getter });
  expect(createSvgPaintRequest(request.artwork, [bad] as never).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(createSvgPaintRequest(request.artwork, Array(20_001).fill(face)).ok).toBe(false);
  expect(createSvgPaintRequest(request.artwork, [{ ...face, extra: true }] as never).ok).toBe(false);
  const sparse = Array(1);
  expect(createSvgPaintRequest(request.artwork, sparse).ok).toBe(false);
});
it('FR-LIB-004: snapshots nested artwork and faces so callers cannot change accepted identity data', () => {
  const request = baseline(3);
  const parsed = parseSvgPaintRequest(request);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  (request.artwork.root.attributes as Record<string, string>)['viewBox'] = '0 0 1 1';
  (request.fonts[0] as { family: string }).family = 'changed';
  expect(parsed.value).toEqual(baseline(3));
});
it('NFR-SEC-001: malformed runtime inputs return diagnostics instead of throwing', () => {
  for (const input of [undefined, 1, [], {}, { ...baseline(), fonts: null }]) expect(parseSvgPaintRequest(input).ok).toBe(false);
  expect(createSvgPaintRequest(null as unknown as SvgArtwork, []).ok).toBe(false);
});
it('FR-LIB-004: exact used font faces have canonical hash ordering, including multi-face artwork', () => {
  const request = baseline(3),
    first = request.fonts[0];
  if (!first) throw Error('missing baseline face');
  const second = { ...first, family: 'SecondFace', sha256: 'f'.repeat(64) };
  const text = request.artwork.root.children.find((n) => typeof n !== 'string' && n.name === 'text');
  if (!text || typeof text === 'string') throw Error('missing text');
  (request.artwork.root.children as unknown[]).push({
    ...text,
    attributes: { ...text.attributes, 'font-family': second.family },
    children: [...text.children],
  });
  const made = createSvgPaintRequest(request.artwork, [first, second]);
  expect(made.ok).toBe(true);
  if (!made.ok) return;
  expect(parseSvgPaintRequest(made.value)).toEqual(made);
  expect(createSvgPaintRequest(request.artwork, [second, first]).ok).toBe(false);
  expect(parseSvgPaintRequest({ ...made.value, fonts: [second, first] }).ok).toBe(false);
});
it('NFR-SEC-001: array accessors, hidden fields and throwing descriptors cannot escape validation', () => {
  const request = baseline(3),
    getter = vi.fn(() => request.fonts[0]);
  const fonts = Object.defineProperty([request.fonts[0]], 0, { get: getter });
  expect(createSvgPaintRequest(request.artwork, fonts as never).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  const hidden = Object.defineProperty(baseline(), 'identity', { enumerable: false });
  expect(parseSvgPaintRequest(hidden).ok).toBe(false);
  expect(parseSvgPaintRequest({ ...baseline(), [Symbol('extra')]: true }).ok).toBe(false);
  const throwing = new Proxy(baseline(), {
    ownKeys() {
      throw Error('untrusted descriptor');
    },
  });
  expect(parseSvgPaintRequest(throwing).ok).toBe(false);
  expect(
    createSvgPaintRequest(
      request.artwork,
      new Proxy([], {
        getPrototypeOf() {
          throw Error('untrusted descriptor');
        },
      }),
    ).ok,
  ).toBe(false);
});

it('NFR-SEC-001: font metadata length limits reject oversized family and hash values', () => {
  const request = baseline(3);
  const first = request.fonts[0];
  if (!first) throw Error('missing baseline face');
  for (const replacement of [{ family: 'x'.repeat(257) }, { sha256: 'a'.repeat(65) }, { sha256: 'a'.repeat(63) }]) {
    expect(createSvgPaintRequest(request.artwork, [{ ...first, ...replacement }]).ok).toBe(false);
    expect(parseSvgPaintRequest({ ...request, fonts: [{ ...first, ...replacement }] }).ok).toBe(false);
  }
});
