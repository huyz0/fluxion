# R0 exit checklist — Foundation

R0 closes with M4 (docs/requirements/01-scope-and-increments.md §2). Its demo: the CLI renders a
JSON document with rectangles and straight lines to an HTML file. Each item below is one of the
exit criteria common to every increment, with the evidence that it holds.

- [x] All `M` requirements of R0 implemented, with passing tests traced by ID — `node scripts/gates/check-trace.mjs --increment R0` prints "338 requirements, 34 named by tests, every Must of R0 covered" (2026-09-29); the traceability matrix is docs/requirements/40-traceability.md.
- [x] CI green on main — run 36501640817 at 343aa78 (2026-09-29): every job passed, the verify job on ubuntu-latest, windows-latest and macos-latest, the visual job against the baselines below, e2e on three engines, a11y, api, size, license and security; `.harness/reviews/ci-evidence.json` records the run at the M4 range end (M4.25).
- [x] Visual-regression baseline updated and reviewed — the first T3 baseline, `e2e/render.static-html.spec.ts-snapshots/two-rects-line-{chromium,firefox,webkit}-linux.png`, taken in the pinned image `mcr.microsoft.com/playwright:v1.63.0-noble` (by digest) in M4.21 and reviewed with its commit (d2725af); CI's visual job compares against it.
- [x] Docs updated (user guide and API reference for touched packages) — the guide "CLI quickstart" in apps/docs (M4.23, ca8a769), the generated API reference of every package (apps/docs build), the READMEs and AGENTS.md notes of theme, render and cli, and 04 §2.2 as built.
- [x] CHANGELOG via changesets — `.changeset/m4-{theme,render,cli,core,schema}.md` (minor) for every package M4 changed.
- [x] A demo document for the increment committed under `examples/` and rendered in CI — `examples/r0-static.flux.json` (two screens, rectangles, straight connectors, token styles; M4.22, ddeae22); CI's build job renders it with the built CLI and uploads `r0-static.html` as the `r0-static-demo` artifact; a CLI e2e case checks it on every run.
- [x] File format changes accompanied by a migration and a round-trip test — R0 has no file container yet (`.flux`, `.flux.html` arrive with the file-format milestones); the document schema is `schemaVersion` 1.0 with its migration chain (`MIGRATIONS`) and the round-trip and preservation tests of @fluxion/schema (FR-DOC-001, FR-DOC-005); M4 changed no document schema.

## Demo

```bash
pnpm i && pnpm run build
node packages/cli/dist/bin.js validate examples/r0-static.flux.json
node packages/cli/dist/bin.js render examples/r0-static.flux.json -o r0-static.html
```
