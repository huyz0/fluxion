# Font engine assets

Pinned WebAssembly for used-glyph font subsetting (ADR-0051). M18.39 adds the editor worker that loads them. The player never ships them.

- `harfbuzz-subset.wasm` is the subset-only module from npm `harfbuzzjs@1.6.4`. It is verified by package integrity. It has no imports and fixed memory of 1040 pages.
- `woff2-codec.wasm` is Google WOFF2 with Brotli v1.2.1, built standalone from `codec.cc` with emsdk 6.0.13. It imports only memory-growth notification and `proc_exit`, starts at 16 MiB and is capped at 128 MiB. It zeroes every destination before encoding or decoding.
- `manifest.json` holds the hashes, source revisions, notices and recorded clean rebuilds. `licenses/` holds the MIT notices of all four sources and of the Emscripten runtime (its own code and musl) linked into the codec; the libc++ code it links is under the LLVM exception, recorded in `runtime`.

Rebuild and verify:

```
node scripts/fonts/build-font-engine.mjs fetch --sources /tmp/font-src
source <emsdk>/emsdk_env.sh   # emsdk 6.0.13
node scripts/fonts/build-font-engine.mjs check --sources /tmp/font-src
npm pack harfbuzzjs@1.6.4 && node scripts/fonts/build-font-engine.mjs harfbuzz --tarball harfbuzzjs-1.6.4.tgz
FLUXION_FONT_ENGINE_SOURCES=/tmp/font-src FLUXION_HARFBUZZJS_TARBALL=harfbuzzjs-1.6.4.tgz node --test tests/harness/font-engine.test.mjs
```

A changed hash is a contract change: update the manifest, record two clean rebuilds and get it reviewed.
