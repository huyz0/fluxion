---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.2; within FR-LIB-003/009 and existing format compatibility rules, subject to independent plan review)
---

# ADR-0048 — Declarative shape packs: indexed categories and portable used definitions

## Context and Problem Statement

FR-LIB-003 requires licensed declarative definitions; FR-LIB-009 requires metadata-only
search, geometry loaded on use and only used definitions in saved files. Current `ShapeDef`
already validates outlines, anchors, regions, handles, sizes, styles and search metadata.
The SDK's `definePack` already registers definitions atomically through core registries
(ADR-0017). It is a runtime API, not a versioned JSON distribution format.

The format writer/loader preserves unknown entries and `manifest.plugins`; executable
plugin loading belongs to M27. M18 must make its shape data portable without treating it
as executable code or embedding a complete 5000-icon collection.

## Decision Drivers

- Existing SDK registration and document-scoped registries remain authoritative.
- Searching must not parse or fetch category geometry (FR-LIB-009).
- Exact versions, content hashes and deterministic ordering make offline files reproducible.
- Pack licensing is required without retroactively breaking the runtime `PackSpec` API.
- No new document record fields or executable plugin permissions are needed for shape data.

## Considered Options

1. **One JSON file with all geometry.** Simple validation and transport, but metadata search
   would load every definition. Rejected for large collections and FR-LIB-009.
2. **Executable ESM packs only.** Reuses today's runtime API, but importing third-party JSON
   becomes code activation and portable saves need M27's trust/runtime machinery. Rejected.
3. **Versioned metadata index, hashed category files, used-only save bundle.** Chosen. Adds
   a data codec and loader while retaining `ShapeDef`, SDK registration and format codecs.

## Decision Outcome

### Distribution format 1.0

`index.json` contains `format: "fluxion-shape-pack"`, `formatVersion: "1.0"`, namespace
`id`, exact-semver `version`, display `name`, nonempty `license` and `attribution`,
`categories` and `definitions`. Namespace syntax is the existing SDK pack-id syntax.

- `categories` maps a category slug to `{ path, sha256 }`. A path is exactly
  `categories/<slug>.json`, relative to the pack root: no URLs, traversal or query strings.
  Category hashes are 64 lowercase hexadecimal SHA-256 digits.
- Each definition index entry is `{ id, name, keywords, category }`. Its qualified `id`
  belongs to the namespace; IDs are unique, and each category names an indexed file.
  These entries contain no geometry or executable values.
- A category file is `{ formatVersion: "1.0", definitions: ShapeDef[] }`. It contains exactly
  the definitions assigned to that category by the index. Validate every definition with
  the existing core parser, including expressions (ADR-0016), before registration.
- Index/category metadata must agree. Unknown format versions, duplicate IDs, mismatched
  hashes, missing/extra definitions or invalid geometry produce structured diagnostics;
  a failed category registers nothing. Never silently repair input while parsing.
- A definition's optional `license` overrides the pack default only under ADR-0050's policy.
  Pack attribution accompanies every used subset; data does not acquire code permissions.

Core owns pure data validation; SDK re-exports the contracts and adapts accepted definitions
through its existing registration path. Preserve existing `PackSpec` calls for shapes,
markers and themes. Serialized pack validation is a separate boundary with mandatory
license/provenance, not a new global registry or an unchecked cast to `PackSpec`.

### Lazy loading and identity

The editor indexes only `index.json`. A caller-injected read/hash port loads and verifies a
category on first use; pure core and format code perform no I/O. Concurrent requests share
a pending category load. Cache identity includes namespace, exact version and index hash.

A document pins one version of a namespace. Conflicting installed and embedded versions
cannot silently overwrite one another: the document's verified embedded definitions are
its authority, and an incompatible replacement is refused with diagnostics. Missing
geometry cannot masquerade as an empty successful pack. User-driven pack upgrades are not
introduced by this decision.

### Used-definition persistence

Before saving, the host resolves all shape `defId`s used by document records, including
children of groups, and passes their validated definitions and provenance to format.
For each used pack write one canonical, sorted `plugins/<id>@<version>/defs.json` containing
`format`, `formatVersion`, `id`, `version`, `license`, `attribution` and only the used
`definitions`. Three referenced IDs out of 5000 produce exactly three definitions.

Add a data-only variant in `manifest.plugins`:
`{ kind: "declarative-shapes", id, version, packFormat: "1.0", entry, integrity }`.
`entry` names that pack's `defs.json`; `integrity` is `sha256-` followed by the base64
encoding of the 32-byte SHA-256 of its canonical bytes, using the existing injected hasher. The normal manifest entry hash/size also covers it.
It has no player entry, SDK import, trust grant or executable payload. The loader validates
both the lock and the subset before a host registers anything, and rejects conflicting
IDs, invalid definitions and mismatched hashes. Rendering must work without the original
pack directory or network. Used-pack attribution is retained for the player credits.

Keep document schema 1.7: shape `defId` records are unchanged. Keep container format 1.0:
its existing extension rules preserve unknown plugin-lock variants and entries. The
implementation commit adds the typed data-lock variant, fixtures, API reports and an
amendment here; old files without it still load. An old reader may show a missing-shape
placeholder, but its unknown-entry round trip must preserve the definitions and lock.
Unknown code-plugin entries remain opaque and preserved; M18 never activates them.

A newly added definition without resolvable provenance fails portable-save preparation;
never invent a pack version or drop it. Preserve already-loaded unknown entries and report
unresolved existing references under the existing missing-plugin compatibility behavior.
My-shapes selection presets and custom connector generators extend this data contract in
their own reviewed implementation amendments (M18.34/M18.38); no executable JSON is allowed.

### Consequences

Good: lazy search and portable used-only saves share one validated definition model. Old
runtime packs and old document records remain compatible. Bad: distribution and saved
subsets are distinct envelopes; both need strict validation and explicit compatibility
fixtures. Hashing and duplicate-load coordination add host work, outside pure packages.

### Confirmation

M18.12 rejects malformed, unlicensed, duplicate and namespace-mismatched packs; registration
is atomic. M18.13 proves index-only search, per-category reads and concurrent-load sharing.
M18.14 proves three-of-5000 embedding, integrity rejection, offline render equality,
byte-preserving legacy/unknown-entry round trips and version-conflict diagnostics.
These cases run in `m18-complete`; authoring docs and 08/09 describe the implemented wire
format. This decision alone does not claim those unimplemented checks pass.

## More Information

ADR-0016 (shape expressions), ADR-0017 (SDK pack registration), ADR-0003/0153 (portable
container and its codec); architecture 08 §2/§4 and 09 §4/§7; M18 backlog rows 12–14.

## Amendments

### M18.38 — pack connector types (FR-CON-010)

A pack may ship `connectors.json`: `{ "format": "fluxion-connector-defs", "formatVersion": "1.0",
"definitions": [...] }`, a separate envelope so shape index/category/subset formats 1.0/1.1 are
unchanged. A definition is data only: `id` (pack namespace, unique), `router` (one of the
built-in `straight`, `curved`, `orthogonal`, `polyline`), `decoration` (closed union `wavy`
{amplitude, wavelength}, `zigzag` {amplitude, wavelength}, `double` {gap}, `pipe` {wall},
`cable` {pitch}; positive lengths in stroke widths, at most 1000), optional `defaultStyle`,
`name`, `describe`, `keywords`. Unknown keys, kinds or code are refused (`FLX_PACK_INVALID`,
core `parseConnectorDefs`). The path generators are routing's `decorateRoute`, chosen by kind.

A host registers each definition in `routers` under its id (routing `connectorDefRouter`): the
router delegates to its base router and carries the decoration. A connector uses the type by
naming the id as `route.type`, which document schema 1.7 already allows, so the document schema
and container are unchanged. Routing, bindings, the global orthogonal pass, parallel fanning and
the editor's route handles follow the base router (`routerBase`); the view strokes the decoration over the trimmed route and keeps the plain
route unstroked for markers. A reader without the pack falls back to the straight router, as for
any unknown router. Wiring `connectors.json` into the pack loader, embedding used connector
definitions in portable saves and offering the types in the editor are follow-up rows.

