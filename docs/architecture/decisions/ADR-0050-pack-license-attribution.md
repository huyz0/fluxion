---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.4; existing NFR-LIC-003 and tech-stack policy, subject to independent review)
---

# ADR-0050 — Preserve pack rights and used-definition credits offline

## Context and Problem Statement

NFR-LIC-003 requires shape/icon licensing, vendor usage rules for brand assets and
attribution embedded in documents. ADR-0048 requires pack `license` and `attribution`
and permits definition-specific licenses. A wrapper package's MIT declaration cannot
replace the rights and notices of the artwork it contains.

The existing policy distinguishes shipped code, content assets and fonts. Its content
exceptions are already in `tech-stack.md` §3; they are not permission to add a code
dependency under the same license. M18 must enforce that distinction without changing
the allowlist, named optional-pack exceptions or denied packages/licenses.

## Decision Drivers

- Preserve NFR-LIC-001/002/003 and the existing named exceptions exactly.
- Require provenance before redistributing first-party or imported packs.
- Keep credits for every used definition, including mixed-license collections.
- Resolve credits from the saved file without an installed pack or a network request.
- Keep declaration validation separate from a claim of verified legal ownership.

## Considered Options

1. **Use only the wrapper's license.** Small metadata, but it loses upstream notices and
   can mislabel an imported collection. Rejected.
2. **Embed every installed pack's complete credits.** Easy to collect, but unrelated packs
   leak into documents and used-only persistence becomes installation-dependent. Rejected.
3. **Explicit pack/source credits, filtered by used definitions.** Chosen. Adds validation
   and subset bookkeeping while making portable files self-contained and deterministic.

## Decision Outcome

### Preserve policy boundaries

Code dependencies keep `LICENSES.allow`, the exact `packExceptions` and package-specific
exceptions from `thresholds.mjs`. Content artwork may additionally use OFL-1.1, CC0-1.0
or CC-BY-4.0 under the existing content-asset rule. Fonts retain the narrower
`FONT_LICENSES` allowlist. No content permission propagates to code, and the ELK/libavoid
exceptions do not become exceptions for arbitrary shape packs.

Use the existing SPDX expression semantics: all obligations of `AND` must be permitted;
an `OR` may use a permitted alternative. Preserve the original expression and notices.
Unknown/free-text licenses fail distribution validation; do not normalize them to MIT.
Preserve the existing GPL/AGPL/SSPL/BUSL and watermark/key-package restrictions. The
existing rule against modifying MPL files also remains; no importer silently waives it.

Pure pack parsing checks structure. The repository's distribution gate and serialized
pack import/registration adapters enforce the same policy, through explicit pure inputs
or a shared pure policy module; core never imports a Node-based gate script. Existing
runtime `PackSpec` calls remain compatible, as ADR-0048 requires.

### Credits and provenance

Supplement ADR-0048's unimplemented format with a nonempty `credits` array. Each record
has a stable pack-local `id`, SPDX `license`, nonempty `attribution`, preserved `notice`
text and a `source` reference. Source is an upstream reference or an explicit original
author statement; never invent a URL or infer ownership from a filename.

An optional `definitionIds` list scopes a credit to those indexed IDs; absent means it
applies to the entire pack. IDs must exist, lists must be nonempty and unique, and credit
IDs must be unique. Every definition must be covered. The pack's own license/attribution
remain required; an optional definition license cannot erase applicable source credits.
Validate each applicable license, so an MIT wrapper cannot conceal a forbidden source.

Imported or redistributed upstream material carries its pinned source revision/hash and
any modification description in the provenance record. The checked-in first-party
source manifest links those hashes to actual input files and license/notice evidence;
the gate verifies those files. Import hosts hash the supplied source bytes and collect
missing declarations before creating a distributable pack. They do not fetch rights
metadata or assume a collection service's software license covers its icons.

Original Fluxion artwork declares its author and MIT notice. Original user artwork needs
the user's explicit rights declaration; missing data produces an actionable diagnostic,
not fabricated permission. Preserve the source input while metadata is being completed.
Schema checks establish complete declarations and integrity, not legal ownership.

### Portable subsets and player credits

For each used pack, ADR-0048's `defs.json` includes its pack attribution, every global
credit and each scoped credit that intersects the used definition IDs. Trim scoped ID
lists to the saved subset; do not embed unused definitions to justify a credit. Sort
records deterministically and preserve notice/source/provenance text without rewriting.
This metadata is covered by the bundle's existing canonical hash and manifest lock.

Player About/Credits reads those embedded records, including definition-specific rights,
and works offline. It renders untrusted text as text. Source links are optional HTTP(S)
links; no HTML, script URLs or automatic fetches come from metadata. An installed pack
cannot overwrite a saved file's pinned credits. Unknown older entries retain ADR-0048's
preservation behavior; missing new provenance fails portable-save preparation explicitly.

### Brand assets and first-party packs

The first-party cloud-architecture pack uses generic original symbols, without vendor
logos or implied endorsement. Third-party brand material must retain its source and
applicable vendor usage rules; an SPDX identifier alone does not establish those rights.
M18 does not add brand packs to the first-party set or an automatic exception for them.
Redistribution without the required evidence remains blocked under the existing policy.

### Consequences

Good: files carry the rights information for the artwork they use, and content permissions
cannot authorize code. Bad: mixed-license imports need source-level metadata and a license
check cannot infer ownership. Required declarations are part of import/save diagnostics.

### Confirmation

M18.12 rejects absent credits/notices, uncovered definitions, invalid IDs and malformed
license declarations. M18.33 extends `check-licenses --packs` without changing existing
code/font policy. Its negative harness cases are named `asset-only licenses do not
authorize code dependencies` and `missing pack notices and forbidden asset licenses fail`.
The completion gate requires those cases, so today's code-only license pass is insufficient.

M18.14's used-definition save and `pack-attribution.test.ts` prove that three selected IDs
keep every applicable mixed-source credit, omit unrelated scoped credits, survive offline
reopen and remain covered by integrity validation. M18.33 proves safe offline rendering
of those credits and preservation of source notices; no missing metadata is silently repaired.

## More Information

- `docs/standards/tech-stack.md` §3; `scripts/gates/thresholds.mjs` license tables.
- `scripts/gates/check-licenses.mjs` and `spdx.mjs`; existing license harness regressions.
- ADR-0048/0049, NFR-LIC-001/002/003 and FR-LIB-009.
