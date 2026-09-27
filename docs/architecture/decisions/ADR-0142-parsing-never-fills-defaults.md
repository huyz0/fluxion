---
status: accepted
date: 2026-09-27
decision-makers: harness (M2 cp1 F2; within FR-DOC-001, FR-DOC-005, FR-SCR-001, NFR-REL-005)
---

# ADR-0142 — Parsing a document never fills in defaults; readers apply documented defaults

## Context and Problem Statement

M2.6–M2.8 gave several schema fields Zod defaults (`screen.name`, `screen.kind`, `screen.size`,
`document.title`, `transform.rot`, `image.fit`, image-paint `fit`, `comment.resolved`), so parsing
returned more than it was given. The M2 cp1 milestone review (F2) found that this breaks the
round trip M2.9 promises (a document parsed and serialized is byte-equal), rewrites AI and
FluxScript output with extra fields on every save, and even made the 02-document-model §7 example
fail to "parse unchanged" without adding `kind: "fixed"`.

## Decision Drivers

- FR-DOC-005 / contracts rule 11: `read(write(doc))` deep-equals `doc`; data is kept verbatim.
- ADR-0004 intent: generated documents stay small; the model stores intent, not derived values.
- FR-SCR-001: a screen without a size is 1920 × 1080 — a rule about meaning, not storage.
- NFR-REL-005: one canonical form per document.

## Considered Options

1. **Schemas validate only; defaults are documented constants applied by readers** through small
   accessors (`screenSize(screen)`, …) and by the theme/render layers.
2. Fill defaults on load and state M2.9's round trip for fully spelled-out input only.

## Decision Outcome

Chosen option 1. No schema in `@fluxion/schema` uses `.default()` or a transform that changes
a valid value: for any document that validates, the parsed value deep-equals the input.
Defaulted fields become optional in the record types, and their TSDoc names the default.
`@fluxion/schema` exports the defaults (`DEFAULT_SCREEN_SIZE`, …) and accessors for the ones
every consumer needs (`screenSize`, `screenKind`, `transformRotation`); layers above apply the
rest at resolve time. Writers may omit a field that equals its default.

### Consequences

- Good: `parse(x)` equals `x` for valid `x`; serialization is canonical from the input alone;
  FluxScript and AI output keep their size.
- Good: FR-SCR-001's default lives in one accessor, tested there.
- Bad: consumers must use the accessors rather than reading `screen.size` directly — the type
  (`size?: Size`) makes forgetting it a compile error.

### Confirmation

- A harness scan (`schema-open-objects.test.mjs`) fails on `.default(`, `.prefault(`, `.catch(` or
  `.transform(` in schema record sources.
- `document-file.test.ts`: the unmodified 02-document-model §7 example parses to itself.
- `records/screen.test.ts`: `FR-SCR-001: WHEN a screen omits size THE SYSTEM SHALL default to
  1920×1080` checks `screenSize()`.

## Pros and Cons of the Options

### Documented defaults applied by readers

- Good: lossless, small files, one canonical form.
- Bad: every reader goes through accessors.

### Defaults filled on load

- Good: readers see complete records.
- Bad: every save rewrites input; the round-trip property holds only for spelled-out input.
