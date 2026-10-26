---
status: accepted
date: 2026-10-26
decision-makers: user authorization and independent M18.67 implementation-plan review
---

# ADR-0179 — Pinned tsrs alongside TypeScript 7

## Context

The user requested adoption of the Rust TypeScript compiler after an isolated measurement.
The official tsrs project links its npm distribution. Its tested release is
`0.18.0-ts7.1.0-dev.20260929`, Apache-2.0, based on TypeScript commit
`b85298b6a81f772d080b0455de0ca9d744cd6fd6`. It reports compiler version
`7.1.0-dev.20260930.4`; the existing reference is stable TypeScript 7.0.2.
These are different compiler revisions, so speed alone does not establish compatibility.

At df3dd17a, three isolated forced builds measured TS7 median 4.261s (4.256–4.384)
and tsrs median 1.118s (1.091–1.121). Warm medians were 0.130s and 0.059s.
All 1,161 declaration files matched, but that experiment did not compare all maps,
full diagnostic probes or incremental invalidation. It is preliminary evidence only.

The pinned npm package includes Linux x64/arm64 GNU/musl and macOS arm64 binaries.
It does not include Windows or macOS x64. Fluxion's Windows CI must keep working.
The installed release also differs from the repository's unreleased fast-mode documentation:
`--fast` is unsupported in this pin. Do not infer equivalent behavior from source-main claims.

## Decision

Install this exact official package as a dev-only catalog dependency alongside TS7.
Preserve the minimum release age, disabled lifecycle scripts, lockfile integrity, license
and security scans. Do not alias or replace the `typescript` package or its compiler API
compatibility pins. Retain the existing browser bundler, tsdown, Vitest and Playwright.

Expose explicit `typecheck:tsrs` and `typecheck:ts7` commands. Keep authoritative
`typecheck` on TS7 until complete project parity and required platform support qualify
promotion. No hidden fallback, experimental fast flags, custom binary override or silent
exclusion of projects counts as qualification. Opt-in tsrs fails normally on an unsupported
platform. A later default switch requires its own reviewed task and evidence.

Provide a reproducible full-solution comparison in isolated copies of current tracked bytes,
with workspace dependencies remapped into each copy. Each compiler gets independent caches
and outputs. Compare exit status, full diagnostic blocks (normalizing source-root paths,
line endings and ordering only), and every emitted declaration, map and JavaScript file.
Exclude only compiler-specific `.tsbuildinfo` caches from byte equality, not code outputs.
Preserve both original logs and a machine-readable inventory/result. Any mismatch fails.

Compare clean forced and unchanged warm builds, then mutate an exported geometry API,
rebuild without force and require errors in a referenced consumer. Restore the API and
require clean diagnostics and the original emitted inventory. Also inject assignment,
optional-property and unresolved-import errors in pure, browser, application and e2e
projects; require failures and compare results, restoring source after every probe.
The snapshot comparison must never mutate the working tree or share mutable outputs.

## Qualification evidence (2026-10-26)

The broader pilot on M18.12's reviewed tree compared 1,276 declarations and 1,276 declaration
maps. All declarations matched; eight editor-story maps differed in their mappings. Both
compilers passed the clean/warm/restored tree and failed every deliberate-error phase.
Changing the referenced Vec2 API produced 1,975 error locations/codes in each compiler;
four diagnostic text renderings differed. Decoding the eight maps shows two added mappings
each and no removed TS7 mappings; no declaration correctness defect was demonstrated. These
differences remain visible rather than being normalized away. The conditional promotion
follow-up (reserved M18.68) is tracked in roadmap Deferred, not as a prerequisite for features.

Dependency qualification also found two existing docs-only transitive advisories, unrelated
to tsrs: GHSA-ch52-4w7c-c8xp in http-cache-semantics 4.2.0 and GHSA-rj75-hqrm-r3gf in
postcss-selector-parser 6.1.4. Pin the registry-reported patched 4.3.0 and 7.1.6 respectively,
retain scanner policies, and verify the docs build because the selector parser crosses a major
version. The cache advisory web page still said no patch when read; the npm audit response
identified >=4.3.0, and that published version's gitHead is the upstream release commit
b1d4bd682fbab0252985de45219f4e7497c0067c. Record fresh audit results, not a suppression.

## Consequences

Developers on supported platforms can use a pinned faster checker while TS7 remains the
portable authority. Finite parity probes are not proof of universal TypeScript equivalence.
Compiler upgrades require fresh measurements and diagnostic/output checks; no errors may
be suppressed to obtain parity. Missing Windows support is a concrete promotion blocker,
not a reason to delay unrelated feature work or remove Windows CI.

## Sources

- https://github.com/oxc-project/tsrs (official npm link and compatibility documentation)
- https://www.npmjs.com/package/tsrs/v/0.18.0-ts7.1.0-dev.20260929
- Published package metadata and installed `lib/getExePath.js`, checked 2026-10-26.
- ADR-0011 (compiler/API split), ADR-0176 (measured, proportionate verification).
