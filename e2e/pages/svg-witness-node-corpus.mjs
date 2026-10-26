// The library owns this browser. Keep it outside the Playwright runner's tracing lifecycle.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { createNodeSvgPaintWitness } = await import(process.env.FLUXION_WITNESS_MODULE);
const { importSvgBatch } = await import(process.env.FLUXION_FORMAT_MODULE);
const { files, ids, theme, font, engine } = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(files.length, 50);
const face = { family: font.family, weight: font.weight, style: font.style, sha256: font.sha256 };
const made = await createNodeSvgPaintWitness({ browser: engine, theme, fonts: [{ ...font, bytes: new Uint8Array(font.bytes) }] });
assert.equal(made.ok, true, JSON.stringify(made));
let observed = 0;
let fontObserved = false;
let negatives = 0;
try {
  const report = await importSvgBatch(
    { kind: 'files', files: files.map((file) => ({ ...file, bytes: new Uint8Array(file.bytes) })) },
    {
      ids,
      fonts: [face],
      defaultFont: font.sha256,
      witness: async (request) => {
        const receipt = await made.value.witness(request);
        assert.deepEqual(receipt, { identity: request.identity, status: 'painted', fontHashes: request.fonts.map((face) => face.sha256) });
        observed++;
        fontObserved ||= request.fonts.length > 0;
        return receipt;
      },
    },
  );
  assert.equal(report.status, 'processed', JSON.stringify(report));
  assert.equal(report.inputCount, 50);
  assert.equal(report.acceptedCount, 50, JSON.stringify(report.inputs.filter((input) => input.status !== 'accepted')));
  assert.deepEqual(
    report.inputs.map((input) => input.path),
    files.map((file) => file.path),
  );
  assert.equal(observed, 50);
  assert.equal(fontObserved, true);
  for (const attribute of ['visibility="hidden"', 'opacity="0"']) {
    const source = `<svg viewBox="0 0 100 100"><rect width="100" height="100" ${attribute}/></svg>`;
    const refused = await importSvgBatch(
      { kind: 'files', files: [{ path: 'hidden.svg', bytes: new TextEncoder().encode(source) }] },
      {
        ids: { 'hidden.svg': 'corpus:hidden' },
        witness: async (request) => {
          const receipt = await made.value.witness(request);
          assert.equal(receipt.status, 'no-witness');
          negatives++;
          return receipt;
        },
      },
    );
    assert.equal(refused.status, 'processed');
    assert.equal(refused.acceptedCount, 0);
  }
  assert.equal(negatives, 2);
} finally {
  const disposed = await made.value.dispose();
  assert.equal(disposed.ok, true, JSON.stringify(disposed));
}
console.log(JSON.stringify({ engine, accepted: observed, negatives, fontObserved, disposed: true }));
