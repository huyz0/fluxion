---
'@fluxion/dsl': patch
---

Add the `test:examples` script: every FluxScript example in `examples/dsl/` compiles against the first-party packs with no error, twice to the same `.flux.json`, and survives a decompile round trip. No change to the shipped package.
