# @fluxion/schema

Zod 4 schemas and TS types for every record of a Fluxion document; IDs and fractional indices;
validation diagnostics; migrations, repair and canonical serialization.

| Layer | Pure | Status |
|---|---|---|
| L0 | yes | M2 — records, validation, migration, `.flux.json` read/write |

## Public surface

| Area | Exports |
|---|---|
| Records | `DocumentFile`, `AnyRecord`, one type per record (`DocumentRecord`, `ScreenRecord`, `ElementRecord` and its kinds, `BindingRecord`, …), `RECORD_TYPES`, `ELEMENT_KINDS`, `SCHEMA_VERSION`, `schemaForRecord` |
| Read / write | `parseDocument` (JSON → migrate → repair → validate, never throws), `serializeDocument` (canonical, byte-stable) |
| Checks | `validate` → `Diagnostic[]` (`DIAGNOSTIC_CODES`, JSON pointers), `isValid`, `checkRichText` |
| Upgrade | `migrate`, `MIGRATIONS`, `repair` |
| IDs & order | `createId`, `isRecordId`, `seededRandom`; `keyBetween`, `nKeysBetween`, `compareKeys` (ADR-0012) |
| Defaults | `screenSize`, `screenKind`, `transformRotation`, `DEFAULT_SCREEN_SIZE` — parsing fills none in (ADR-0142) |
| Tests | `@fluxion/schema/testing`: `documentBuilder`, fast-check arbitraries |

Record types are written by hand and checked against their schemas at compile time
(ADR-0140). Field catalogue: [02-document-model.md](../../docs/architecture/02-document-model.md).
Not yet here: JSON Schema generation (FR-AI-001).

```ts
import { parseDocument, type ScreenRecord, screenSize, serializeDocument } from '@fluxion/schema';

const r = parseDocument(text);
if (!r.ok) throw new Error(r.error.diagnostics.map((d) => `${d.path}: ${d.message}`).join('\n'));
const { document, diagnostics } = r.value; // warnings only; no defaults filled in
const size = screenSize(document.records.s1 as ScreenRecord); // 1920×1080 when the screen has no size
const out = serializeDocument(document); // same bytes for a canonical input
```

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
