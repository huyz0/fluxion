// Host probe, run under `node --disallow-code-generation-from-strings` (tests/harness/font-engine.test.mjs): exercises the pinned font engines on a real font, on
// malformed input and with dirty output buffers, and prints one JSON result (M18.48, ADR-0051).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [assets, fontPath] = process.argv.slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_SFNT = 5 * 1024 * 1024;

class Exit extends Error {}
async function codec() {
  const { instance } = await WebAssembly.instantiate(readFileSync(join(assets, 'woff2-codec.wasm')), {
    env: { emscripten_notify_memory_growth: () => {} },
    wasi_snapshot_preview1: {
      proc_exit: (code) => {
        throw new Exit(`exit ${code}`);
      },
    },
  });
  instance.exports._initialize();
  return instance.exports;
}
async function harfbuzz() {
  const { instance } = await WebAssembly.instantiate(readFileSync(join(assets, 'harfbuzz-subset.wasm')), {});
  instance.exports._initialize?.();
  return instance.exports;
}
const copyIn = (x, alloc, bytes) => {
  const at = alloc(bytes.length);
  new Uint8Array(x.memory.buffer, at, bytes.length).set(bytes);
  return at;
};

/** Decode with a host cap and a canary after the destination; returns { size, canary } or a trap name. */
function decode(c, bytes, capacity) {
  const input = copyIn(c, c.codec_alloc, bytes);
  try {
    const declared = c.woff2_final_size(input, bytes.length);
    const cap = Math.min(capacity ?? declared, MAX_SFNT);
    if (cap <= 0) return { size: 0, canary: true };
    const out = c.codec_alloc(cap + 16);
    new Uint8Array(c.memory.buffer, out + cap, 16).fill(0xc3);
    const size = c.woff2_decode(input, bytes.length, out, cap);
    const result = {
      size,
      canary: new Uint8Array(c.memory.buffer, out + cap, 16).every((b) => b === 0xc3),
      bytes: new Uint8Array(c.memory.buffer, out, size).slice(),
    };
    c.codec_free(out);
    return result;
  } finally {
    c.codec_free(input);
  }
}

/** Encode into a destination pre-filled with `fill`, as a reused heap would be. */
function encode(c, sfnt, fill, capacity) {
  const input = copyIn(c, c.codec_alloc, sfnt);
  const cap = capacity ?? c.woff2_max_encoded(input, sfnt.length);
  const out = c.codec_alloc(cap + 16);
  new Uint8Array(c.memory.buffer, out, cap + 16).fill(fill);
  const size = c.woff2_encode(input, sfnt.length, out, cap);
  const result = {
    size,
    canary: new Uint8Array(c.memory.buffer, out + cap, 16).every((b) => b === fill),
    bytes: new Uint8Array(c.memory.buffer, out, size).slice(),
  };
  c.codec_free(out);
  c.codec_free(input);
  return result;
}

function subset(h, sfnt, text) {
  const data = copyIn(h, h.malloc, sfnt);
  const blob = h.hb_blob_create(data, sfnt.length, 2, 0, 0);
  const face = h.hb_face_create(blob, 0);
  const input = h.hb_subset_input_create_or_fail();
  const unicodes = h.hb_subset_input_unicode_set(input);
  for (const ch of text) h.hb_set_add(unicodes, ch.codePointAt(0));
  const result = h.hb_subset_or_fail(face, input);
  let bytes;
  if (result) {
    const out = h.hb_face_reference_blob(result);
    bytes = new Uint8Array(h.memory.buffer, h.hb_blob_get_data(out, 0), h.hb_blob_get_length(out)).slice();
    h.hb_blob_destroy(out);
    h.hb_face_destroy(result);
  }
  h.hb_subset_input_destroy(input);
  h.hb_face_destroy(face);
  h.hb_blob_destroy(blob);
  h.free(data);
  return bytes;
}

/** Deterministic xorshift so malformed cases are the same on every run. */
function* random(seed) {
  let x = seed >>> 0;
  for (;;) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    yield (x >>> 0) / 2 ** 32;
  }
}

/** Malformed inputs: bit flips, truncations, random bytes and an absurd declared size. */
function malformedCases(font) {
  const rnd = random(18048);
  const next = () => rnd.next().value;
  const cases = [];
  for (let i = 0; i < 300; i++) {
    const bytes = font.slice();
    for (let k = 0; k < 1 + Math.floor(next() * 8); k++) bytes[Math.floor(next() * bytes.length)] ^= 1 << Math.floor(next() * 8);
    cases.push(bytes);
  }
  for (let n = 0; n < font.length; n += 997) cases.push(font.slice(0, n));
  for (let i = 0; i < 50; i++) cases.push(Uint8Array.from({ length: 64 + i * 37 }, () => Math.floor(next() * 256)));
  const huge = font.slice();
  new DataView(huge.buffer).setUint32(16, 0xffffffff); // totalSfntSize: the host cap applies before allocation
  cases.push(huge);
  return cases;
}

/** Each malformed input is either refused or decoded within the cap; a trapped instance is replaced, as a worker would be. */
async function malformed(font) {
  let c = await codec();
  const cases = malformedCases(font);
  const out = { cases: cases.length, refused: 0, decoded: 0, traps: 0, canariesIntact: true, maxSize: 0, maxMemory: 0 };
  for (const bytes of cases) {
    try {
      const r = decode(c, bytes);
      out[r.size ? 'decoded' : 'refused']++;
      out.canariesIntact &&= r.canary;
      out.maxSize = Math.max(out.maxSize, r.size);
    } catch (e) {
      if (!(e instanceof WebAssembly.RuntimeError || e instanceof Exit)) throw e;
      out.traps++;
      c = await codec();
    }
    out.maxMemory = Math.max(out.maxMemory, c.memory.buffer.byteLength);
  }
  return out;
}

async function main() {
  const font = new Uint8Array(readFileSync(fontPath));
  const result = { codegenBlocked: false };
  try {
    new Function('return 1');
  } catch (e) {
    result.codegenBlocked = e instanceof EvalError;
  }
  const c = await codec();
  const h = await harfbuzz();
  const hbPages = h.memory.buffer.byteLength / 65536;
  const sfnt = decode(c, font);
  const small = subset(h, sfnt.bytes, 'Fluxion office ffi café 0123456789');
  const encodes = [0x00, 0xa5, 0xff, 0x5a].map((fill) => encode(c, small, fill));
  const again = decode(c, encodes[1].bytes);
  result.pipeline = {
    sourceBytes: font.length,
    sfntBytes: sfnt.size,
    subsetBytes: small?.length ?? 0,
    woff2: encodes.map((e) => ({ size: e.size, sha256: sha256(e.bytes), canary: e.canary })),
    redecodedBytes: again.size,
    redecodedSubsetSha256Matches:
      again.size > 0 && sha256(subset(h, again.bytes, 'Fluxion') ?? new Uint8Array()) === sha256(subset(h, small, 'Fluxion') ?? new Uint8Array()),
  };
  const tight = encode(c, small, 0xee, 64);
  const shortDecode = decode(c, font, 1024);
  result.bounds = { encodeTooSmall: { size: tight.size, canary: tight.canary }, decodeTooSmall: { size: shortDecode.size, canary: shortDecode.canary } };
  result.harfbuzz = {
    pages: hbPages,
    garbage:
      subset(
        h,
        Uint8Array.from({ length: 4096 }, (_, i) => (i * 131) & 255),
        'abc',
      ) === undefined,
    empty: subset(h, new Uint8Array(0), 'abc') === undefined,
    pagesAfter: h.memory.buffer.byteLength / 65536,
  };
  result.malformed = await malformed(font);
  console.log(JSON.stringify(result));
}

await main();
