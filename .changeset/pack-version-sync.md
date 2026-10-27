---
"@fluxion/sdk": minor
"@fluxion/pack-basic": patch
"@fluxion/pack-flowchart": patch
"@fluxion/pack-arrows": patch
"@fluxion/pack-callouts": patch
"@fluxion/pack-infographic": patch
"@fluxion/pack-uml": patch
---

The pack version ledger never records the unreleased `0.0.0` (`UNRELEASED_PACK_VERSION`) and fails when a version named in `CHANGELOG.md` loses its entry; `pnpm run version-packages` keeps each pack's `VERSION`, `pack/` and ledger in step with `changeset version`, and a pack write run needs `vitest -u` (ADR-0194).
