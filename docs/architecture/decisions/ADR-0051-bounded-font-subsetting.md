---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.5; FR-AST-003, subject to independent review)
---

# ADR-0051 — Bounded offline font subsetting with HarfBuzz and WOFF2

## Context and Problem Statement

FR-AST-003 requires optional used-glyph font subsetting on save. ADR-0022 deferred the
engine choice and already requires licensed, embedded fonts. A smaller file must retain
text shaping, recorded metrics, author notices and offline rendering. A font parser is
also an untrusted-input boundary; a package that needs JavaScript string evaluation is
incompatible with the editor's existing security standard.

## Decision Drivers

- Valid WOFF2, including shaping/composite closure, rather than a PDF-only glyph fragment.
- Deterministic bytes, content hashes and layout fingerprints (FR-AST-003).
- Offline editor and CLI operation, unchanged exported-player CSP (NFR-SEC-002).
- Bounded allocations and cancellation without introducing I/O into pure packages.
- Existing font licensing and notices (NFR-LIC-001/003); no new license exceptions.

## Considered Options

1. **Fontkit subsets.** Useful glyph/layout APIs, but upstream describes its subsets as
   minimal PDF-oriented fonts lacking standalone tables such as cmap. Rejected as the
   standalone WOFF2 pipeline.
2. **subset-font/fontverter or woff2-encoder wrappers.** Convenient Node or browser APIs,
   but subset-font uses Node filesystem loading. Both inspected woff2-encoder versions
   fail initialization when JavaScript string code generation is forbidden. Rejected
   without relaxing CSP or importing Node into a shared pure layer.
3. **Direct HarfBuzz subset WASM plus bounded standalone Google WOFF2 WASM.** Chosen.
   Larger maintenance surface and pinned build assets, but explicit memory limits,
   no generated JavaScript glue and the same byte transformation in editor and CLI.

## Decision Outcome

### Engine and ownership

Use the subset-only module from MIT `harfbuzzjs@1.6.4`, pinned with its package integrity
and upstream revision. Instantiate its C ABI directly; do not ship the shaping wrapper.
The inspected subset module has no imports and fixed 65 MiB linear memory. A small
reviewed adapter owns allocation/free and checks every returned handle and length.

Build the MIT Google WOFF2 encoder/decoder as standalone WASM against pinned MIT Brotli.
The initial pins and compiler digest are in the research record. The codec exposes only
bounded decode/encode and allocation functions; no filesystem or generated JS glue.
Zero the output region before encoding: upstream rounds the result to four-byte
alignment without writing those padding bytes. Otherwise stale heap bytes make output
nondeterministic and can disclose prior input. Test dirty-buffer reuse explicitly.

M18.48 creates reproducible assets, source/license manifest, build recipe, hashes and
host probes before M18.39 integrates them. Verify reproducibility from clean pinned
inputs; retain source notices for both binaries. Distribution remains subject to the
existing license/security checks. No new production dependency is added by this ADR.

Shared transformation code belongs in `format`, accepts bytes and explicitly supplied
module/engine ports, and has no fetch, filesystem, clock, DOM or timers. Editor workers
and CLI worker threads own asset loading, cancellation, hashing ports and diagnostics.
Neither SDK nor CLI imports the editor. The exported player receives only font bytes
and metadata; it never receives or executes either engine.

### Limits and CSP

Process one font at a time in a disposable host worker. Enforce the existing 5 MiB
upload limit on source bytes and also cap decoded SFNT and encoded output at 5 MiB;
check sizes before allocation and after each stage. HarfBuzz remains fixed at 65 MiB;
codec memory starts at 16 MiB and cannot grow beyond 128 MiB. Reject malformed table
ranges, unsupported collection/variable-font cases and failed allocations with a typed
fallback diagnostic. A host watchdog terminates a font job after 30 seconds; cancellation
also terminates the worker. Neither clock nor termination logic belongs in `format`.

WASM linear memory is not proof of the editor's <300 MB JS heap requirement. M18.39
measures the actual one-worker peak, releases worker buffers and preserves NFR-PERF-007;
no memory threshold changes are authorized here.

Trusted editor worker responses may allow `script-src 'self' 'wasm-unsafe-eval'` while
keeping JavaScript `unsafe-eval` forbidden. Pin/verify shipped engine assets and restrict
worker/connect sources to application assets; user fonts are data, never module bytes.
Test both successful WASM execution and blocked `Function`/eval, and rejection without
the WASM permission. Do not change the exported player's CSP. Offline caching must
include the worker and verified engine assets; unavailable assets trigger safe fallback.

### Glyph closure and license eligibility

Collect exact Unicode scalar sequences from every persisted screen's text, rich-text
run, label and state/animation text value, grouped by actual font face and weight/style.
Include generated text only when its complete finite values are known. Unbounded data
bindings, unknown custom renderers or unsupported shaping formats retain the full font;
never infer a character inventory from only the visible screen. Preserve variation
selectors and combining marks; do not normalize or rewrite the document's strings.

Feed the sorted unique Unicode inventory to HarfBuzz and retain its default shaping and
composite closure. Preserve all applicable layout feature tags, script/language systems,
name/license records, metrics and hinting. Do not drop closure/features to meet size.
Tests must compare shaped glyph advances and rendered text with the source, including
ligatures, combining marks, supplementary characters and missing-glyph behavior.
Unsupported fonts retain their original bytes with an actionable diagnostic.

Preserve source copyright, license text/URL, author names and provenance in both the
font's metadata and saved credits. An OFL label alone is insufficient to ignore Reserved
Font Names. Initially subset only verified sources without an RFN restriction or with
recorded explicit permission for that modification. An RFN-bearing or unclear uploaded
font stays whole, with a reason; do not silently rename it or treat webfont embedding as
an exemption. This changes neither FONT_LICENSES nor source attribution policy.

### Cache, identity and saving

The cache key contains source-byte SHA-256, face index, selected weight/style/axes,
Unicode inventory, retained features, engine/codec hashes and adapter policy version.
Do not key by display family name. Hash actual final WOFF2 bytes for asset integrity.
Include that output hash and recorded metric/shaping identity in the layout fingerprint;
a source, inventory or policy change invalidates the corresponding cache entry. Identical
inputs must yield byte-identical output across fresh workers and supported hosts.

The option is off by default. Disabled saves preserve existing whole-font behavior.
Enabled saves build a candidate copy, validate/reopen every replacement and commit only
complete valid output. Never replace the live document's original font bytes. A failed,
unsupported, cancelled, unavailable or larger subset retains that font unchanged and
reports a structured reason; other eligible fonts may still be reduced. Do not label a
fallback as a successful subset or use it to satisfy the 60000-byte qualification leg.

Saved files contain enough font bytes, metrics and notices to render offline. Reopened
subset-only documents retain their embedded inventory: editing text beyond that inventory
requires the original font or reports the existing missing-glyph/font diagnostic. Do not
fetch a font silently or invent missing glyphs. Re-saving cannot recover discarded glyphs;
retain original-source identity separately from the subset's integrity hash.

M18.40 updates the existing whole-font statement in `specs/format/flux-1.0.md` alongside
migration/compatibility fixtures and any schema/API reports required by the chosen
metadata representation. Older whole-font files remain readable and round-trip unchanged;
unknown entries retain the established preservation behavior. This ADR does not change
the format major version or introduce a player runtime dependency.

### Consequences and Confirmation

The engine can run offline without dynamic JavaScript, at the cost of two maintained
binary assets and explicit worker/memory policy. Conservative fallback preserves content
but cannot promise every font becomes smaller.

M18.48 proves pinned binary hashes/rebuilds, notices, bounded malformed-input behavior,
zeroed padding, native no-string-codegen execution and browser worker CSP positive/negative
cases. M18.39's `font-subset.test.ts` checks closure, deterministic cache invalidation,
RFN/full-font fallback and the unchanged 60000-byte limit on a pinned, representative
full Latin Google-font weight. Choose and document that fixture before implementation;
the exploratory already-subset Inter face is not this qualification fixture.
M18.40's `library.font-subset` browser tests and CLI tests prove disabled/default saves,
errors/cancellation, offline reopen/render, inventory-aware editing and unchanged source
bytes. Full browser/OS support, memory and font fidelity remain implementation gates;
the architecture probe alone does not establish them.

## More Information

- [Dated engine evidence](../../research/07-font-subset-engine.md).
- ADR-0022 and ADR-0148; FR-AST-003; `docs/standards/security.md`.
