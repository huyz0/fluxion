# Font subset engine evidence — 2026-10-25

Question: which offline editor/CLI engine can emit standalone WOFF2 without JavaScript
string evaluation, while preserving shaping, notices and bounded resource use?

## Primary sources and choice

- [HarfBuzz.js](https://github.com/harfbuzz/harfbuzzjs), MIT, npm 1.6.4,
  revision `3f162fa2c6ba68b40839fe2c11502a26632e20df`.
  Its subset-only binary has no imports and fixed 1040 WASM pages (65 MiB), as confirmed
  by its memory section and that revision's Makefile. The shaping build differs.
- [HarfBuzz subset API](https://harfbuzz.github.io/harfbuzz-hb-subset.html): retain default
  layout/composite closure; preserve all name IDs and layout feature tags explicitly.
- [Google WOFF2](https://github.com/google/woff2), MIT, source revision
  `fb9c3379f2605b10f3e8f1d9636664ab5576775c`; bounded WOFF2MemoryOut decoding and encoder
  output capacity. Its encoder rounds the output offset without initializing padding.
- [Brotli v1.2.1](https://github.com/google/brotli/releases/tag/v1.2.1), MIT, revision
  `db24a98aed38a16de78cc05ca15cdd8dc2a0d92d`. The release identifies a security fix;
  do not substitute an older source solely to simplify the build.
- [Fontkit subsets](https://github.com/foliojs/fontkit#subsets) lack standalone tables
  such as cmap; they are unsuitable for this WOFF2 output contract.
- [subset-font](https://github.com/papandreou/subset-font), BSD-3-Clause, 2.9.0 uses
  filesystem module loading and fontverter. It informs the adapter but is not a shared
  browser/pure-layer implementation.
- Published MIT `woff2-encoder` 2.0.0 and 3.0.0-beta.1 artifacts both fail initialization
  under Node `--disallow-code-generation-from-strings`. Reject those wrappers rather
  than permit dynamic JavaScript. The tag README lookup was inaccessible; no claim is
  made that it was read, and it was not fetched through an alternate route.

## Exploratory results, not feature qualification

Built standalone Google codec with Emscripten 6.0.13, Docker linux/amd64 image
`emscripten/emsdk@sha256:badbe38bedc8f4ff88a5a24672a2d59606015ba9a3bbe69801ad2fbdf75ab500`.
The build ran without container network access against the above pinned sources.
Compiler options use standalone WASM, 16 MiB initial/128 MiB maximum memory, 1 MiB stack,
no filesystem and only allocation/codec exports. No generated JavaScript is loaded.
The binary imports memory-growth notification and proc_exit only; exit traps fail the job.

The initial repeated encode exposed three differing trailing padding bytes. Zeroing the
entire destination buffer before each encode removed that difference. This is both a
reproducibility requirement and protection against leaking previously allocated data.

Existing Inter Latin 400 WOFF2 (23664 bytes) decoded to 66912-byte SFNT, subset to 8108
bytes for `Fluxion office ffi café 0123456789`, encoded to 3924-byte WOFF2 and decoded
again successfully. Repeated output SHA-256:
`edd12f79b99ca2e2a6563390d6536abf95344e7845dc7eb5c23f7d2d61e39910`.
Actual module memories were 65 MiB and 16 MiB. The native string-codegen prohibition
remained active. A Chromium worker produced identical sizes/determinism and FontFace
accepted the output. Function construction remained blocked; omitting the worker's
WASM CSP permission caused the expected compilation rejection.

These are scratch prototypes, not production tests. The input was already a Latin
subset, so this does not prove the full-font 60000-byte requirement, shaping fidelity,
malformed-font bounds, memory budget, reproducible builds or Firefox/WebKit support.
M18.48/39/40 own those checks; no binary or dependency is added with this record.

## Policy implications

[MDN's CSP documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)
distinguishes `wasm-unsafe-eval` from JavaScript `unsafe-eval`. Permit only trusted
editor worker WASM when qualified; keep JS evaluation blocked and player CSP unchanged.

[The OFL author's guidance](https://openfontlicense.org/webfonts-and-reserved-font-names/)
treats character-limited webfont subsets as modified versions. Do not assume the original
reserved name is usable. Initial support should keep RFN/unclear sources whole unless
explicit permission is recorded, preserving all notices in either case.

Recommendation: direct subset-only HarfBuzz plus bounded standalone Google WOFF2, with
reproducible assets and worker security tests as a prerequisite. ADR-0051 records the
save, closure, identity, fallback and license contracts.
