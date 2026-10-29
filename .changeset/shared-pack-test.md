---
"@fluxion/sdk": minor
---

`@fluxion/sdk/testing` exports `testShapePack(source, globs)`: called inside a pack's `describe` with its exported source and its `import.meta.glob` results, it registers the shared pack test (compare, or rewrite on `VITE_FLUXION_WRITE_PACK=1` with `vitest run -u`). Vitest is an optional peer dependency of the testing entry.
