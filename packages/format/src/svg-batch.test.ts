import { expect, it, vi } from 'vitest';
import { sha256Hex } from './sha256.js';
import { importSvgBatch } from './svg-batch.js';
import type { SvgPaintWitness } from './svg-import.js';
import { encodeUtf8 } from './utf8.js';
import { writeZip } from './zip.js';

// Pure orchestration port, not evidence of actual host paint; M18.15/E2E owns that qualification.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });
const svg = '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
const file = (path: string, text = svg) => ({ path, bytes: encodeUtf8(text) });

it('FR-LIB-004: preserves sorted successes, refusals, source hashes and four anchors', async () => {
  const result = await importSvgBatch(
    { kind: 'files', files: [file('z.svg'), file('bad.svg', '<svg/>'), file('notes.txt', 'note'), file('a.SVG')] },
    { ids: { 'z.svg': 'demo:z', 'bad.svg': 'demo:bad', 'a.SVG': 'demo:a' }, witness },
  );
  expect(result.status).toBe('processed');
  if (result.status !== 'processed') return;
  expect([result.inputCount, result.svgCount, result.acceptedCount]).toEqual([4, 3, 2]);
  expect(result.inputs.map((r) => [r.path, r.status])).toEqual([
    ['a.SVG', 'accepted'],
    ['bad.svg', 'refused'],
    ['notes.txt', 'refused'],
    ['z.svg', 'accepted'],
  ]);
  expect(result.inputs[1]?.sourceSha256).toBe(sha256Hex(encodeUtf8('<svg/>')));
  for (const item of result.inputs) if (item.status === 'accepted') expect(item.value.definition.anchors).toHaveLength(4);
});

it('NFR-SEC-001: rejects traversal, normalized collisions and invalid ID maps before any witness', async () => {
  const port = vi.fn(witness);
  for (const files of [[file('../a.svg')], [file('a.svg'), file('A.svg')], [file('é.svg'), file('e\u0301.svg')], [file('x/', 'oops')]]) {
    const result = await importSvgBatch({ kind: 'files', files }, { ids: {}, witness: port });
    expect(result.status).toBe('preflight-failed');
  }
  for (const ids of [{}, { 'a.svg': 'unqualified' }, { 'a.svg': 'demo:a', 'ghost.svg': 'demo:b' }])
    expect((await importSvgBatch({ kind: 'files', files: [file('a.svg')] }, { ids, witness: port })).status).toBe('preflight-failed');
  expect(
    (await importSvgBatch({ kind: 'files', files: [file('a.svg'), file('b.svg')] }, { ids: { 'a.svg': 'demo:a', 'b.svg': 'demo:a' }, witness: port })).status,
  ).toBe('preflight-failed');
  expect(port).not.toHaveBeenCalled();
});

it('FR-LIB-004 NFR-SEC-001: ZIP and named inputs agree; corrupt archives do not invent enumeration', async () => {
  const files = [file('folder/', ''), file('folder/a.svg')];
  const zip = writeZip(files.map((f) => ({ name: f.path, bytes: f.bytes })));
  expect(zip.ok).toBe(true);
  if (!zip.ok) return;
  const options = { ids: { 'folder/a.svg': 'demo:a' }, witness };
  expect(await importSvgBatch({ kind: 'zip', bytes: zip.value }, options)).toEqual(await importSvgBatch({ kind: 'files', files }, options));
  expect(await importSvgBatch({ kind: 'zip', bytes: new Uint8Array([1, 2]) }, options)).toMatchObject({
    status: 'preflight-failed',
    enumerationComplete: false,
    inputs: [],
  });
  expect((await importSvgBatch({ kind: 'files', files: [file('folder/', '')] }, { ids: {}, witness })).status).toBe('preflight-failed');
});

it('NFR-SEC-001: malformed UTF8 and oversized decoded SVG fail individually without hiding later inputs', async () => {
  const result = await importSvgBatch(
    { kind: 'files', files: [{ path: 'a.svg', bytes: new Uint8Array([0xc0, 0xaf]) }, file('b.svg', ' '.repeat(2 * 1024 * 1024 + 1)), file('c.svg')] },
    { ids: { 'a.svg': 'demo:a', 'b.svg': 'demo:b', 'c.svg': 'demo:c' }, witness },
  );
  expect(result.status).toBe('processed');
  if (result.status === 'processed') expect(result.inputs.map((r) => r.status)).toEqual(['refused', 'refused', 'accepted']);
});

it('NFR-SEC-001: snapshots bytes and all conversion context before the first await', async () => {
  const files = [file('a.svg'), file('b.svg')];
  const ids = { 'a.svg': 'demo:a', 'b.svg': 'demo:b' };
  const options = { ids, witness: vi.fn(witness), colors: {}, tokenRefs: new Set<string>() };
  options.witness.mockImplementationOnce(async (r) => {
    files[1]?.bytes.fill(0);
    ids['b.svg'] = 'invalid';
    Object.assign(options.colors, { black: 'theme:missing' });
    options.tokenRefs.add('invalid');
    return witness(r);
  });
  const result = await importSvgBatch({ kind: 'files', files }, options);
  expect(result.status).toBe('processed');
  if (result.status === 'processed') expect(result.acceptedCount).toBe(2);
});

it('NFR-SEC-001: count and inflated byte limits refuse before any rendering', async () => {
  const port = vi.fn(witness);
  const entries = Array.from({ length: 4097 }, (_, i) => file(`${i}.svg`));
  expect((await importSvgBatch({ kind: 'files', files: entries }, { ids: {}, witness: port })).status).toBe('preflight-failed');
  const large = new Uint8Array(128 * 1024 * 1024 + 1);
  expect((await importSvgBatch({ kind: 'files', files: [{ path: 'a.svg', bytes: large }] }, { ids: {}, witness: port })).status).toBe('preflight-failed');
  const block = large.subarray(0, 100 * 1024 * 1024);
  expect(
    (await importSvgBatch({ kind: 'files', files: ['a', 'b', 'c'].map((p) => ({ path: `${p}.svg`, bytes: block })) }, { ids: {}, witness: port })).status,
  ).toBe('preflight-failed');
  const zipped = writeZip([{ name: 'a.svg', bytes: encodeUtf8(svg), method: 'store' }]);
  if (!zipped.ok) throw new Error('fixture ZIP');
  const view = new DataView(zipped.value.buffer);
  const central = view.getUint32(zipped.value.length - 6, true);
  view.setUint32(central + 24, 128 * 1024 * 1024 + 1, true);
  expect((await importSvgBatch({ kind: 'zip', bytes: zipped.value }, { ids: { 'a.svg': 'demo:a' }, witness: port })).status).toBe('preflight-failed');
  expect(port).not.toHaveBeenCalled();
});

it('FR-LIB-004: the frozen 50-input pure batch retains every definition and font obligation', async () => {
  const corpus = import.meta.glob('../../../specs/import/corpus/svg/*.svg', { query: '?raw', import: 'default', eager: true });
  const files = Object.entries(corpus).map(([path, text]) => file(path.slice(path.lastIndexOf('/') + 1), text as string));
  const ids = Object.fromEntries(files.map((f, i) => [f.path, `demo:shape${i}`]));
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
  const result = await importSvgBatch({ kind: 'files', files }, { ids, witness, fonts: [face], defaultFont: face.sha256 });
  expect(result.status).toBe('processed');
  if (result.status !== 'processed') return;
  expect([result.inputCount, result.svgCount, result.acceptedCount]).toEqual([50, 50, 50]);
  expect(result.inputs.some((r) => r.status === 'accepted' && r.value.fonts.length > 0)).toBe(true);
  for (const item of result.inputs) if (item.status === 'accepted') expect(item.value.definition.anchors?.length).toBeGreaterThanOrEqual(4);
});

it('NFR-SEC-001 FR-LIB-004: later entries retain snapshotted font faces and token context', async () => {
  const text = '<svg viewBox="0 0 100 40"><text x="5" y="20" fill="red">API</text></svg>';
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
  const colors = { red: '{color.accent}' as const };
  const tokenRefs = new Set(['{color.accent}']);
  const port = vi.fn(witness).mockImplementationOnce(async (r) => {
    face.family = 'Changed';
    face.sha256 = 'b'.repeat(64);
    tokenRefs.clear();
    return witness(r);
  });
  const result = await importSvgBatch(
    { kind: 'files', files: [file('a.svg', text), file('b.svg', text)] },
    { ids: { 'a.svg': 'demo:a', 'b.svg': 'demo:b' }, fonts: [face], defaultFont: face.sha256, colors, tokenRefs, witness: port },
  );
  expect(result.status).toBe('processed');
  if (result.status !== 'processed') return;
  expect(result.acceptedCount).toBe(2);
  for (const r of result.inputs)
    if (r.status === 'accepted') {
      expect(r.value.fonts[0]?.family).toBe('Inter');
      expect(r.value.fonts[0]?.sha256).toBe('a'.repeat(64));
      expect(r.value.definition.artwork?.colors).toEqual(colors);
    }
});

it('NFR-SEC-001: batch opts into strict ZIP names and rejects malformed runtime inputs', async () => {
  const zip = writeZip([{ name: 'x.svg', bytes: encodeUtf8(svg), method: 'store' }]);
  if (!zip.ok) throw new Error('fixture ZIP');
  const central = new DataView(zip.value.buffer).getUint32(zip.value.length - 6, true);
  zip.value[30] = 0xff;
  zip.value[central + 46] = 0xff;
  const port = vi.fn(witness);
  expect(await importSvgBatch({ kind: 'zip', bytes: zip.value }, { ids: { '\uFFFD.svg': 'demo:x' }, witness: port })).toMatchObject({
    status: 'preflight-failed',
    enumerationComplete: false,
  });
  for (const input of [null, {}, { kind: 'files', files: [null] }])
    expect((await importSvgBatch(input as Parameters<typeof importSvgBatch>[0], { ids: {}, witness: port })).status).toBe('preflight-failed');
  expect(port).not.toHaveBeenCalled();
});

it.each(['files', 'zip'] as const)('NFR-SEC-001: Node Buffer %s inputs are owning snapshots', async (transport) => {
  // Test-only Node subclass; keep Node ambient types out of the pure package project.
  const module = 'node:buffer';
  const { Buffer } = (await import(module)) as { Buffer: { from(value: string | Uint8Array): Uint8Array } };
  const second = Buffer.from(svg);
  const zip = writeZip([
    { name: 'a.svg', bytes: encodeUtf8(svg), method: 'store' },
    { name: 'b.svg', bytes: encodeUtf8(svg), method: 'store' },
  ]);
  if (!zip.ok) throw new Error('fixture ZIP');
  const archive = Buffer.from(zip.value);
  const port = vi.fn(witness).mockImplementationOnce(async (r) => {
    second.fill(0);
    archive.fill(0);
    return witness(r);
  });
  const input =
    transport === 'files'
      ? {
          kind: 'files' as const,
          files: [
            { path: 'a.svg', bytes: Buffer.from(svg) },
            { path: 'b.svg', bytes: second },
          ],
        }
      : { kind: 'zip' as const, bytes: archive };
  const result = await importSvgBatch(input, { ids: { 'a.svg': 'demo:a', 'b.svg': 'demo:b' }, witness: port });
  expect(result.status).toBe('processed');
  if (result.status !== 'processed') return;
  expect(result.acceptedCount).toBe(2);
  expect(result.inputs.map((r) => r.sourceSha256)).toEqual([sha256Hex(encodeUtf8(svg)), sha256Hex(encodeUtf8(svg))]);
});
