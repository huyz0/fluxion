# Diagnostics reference

> Read when: interpreting a `validate()` result, adding a diagnostic code, or writing a tool
> (CLI, MCP, AI repair) that reacts to one. Source of truth for severities:
> `packages/schema/src/diagnostics.ts` (`DIAGNOSTIC_CODES`). Codes are public API: add, never
> rename (FR-DOC-004, contracts.md).

Every diagnostic has a stable `code`, a `severity` (`error` makes the document invalid;
`warning` marks data that is kept but not understood, or will be repaired; `info` is advice), a
JSON pointer `path` (RFC 6901), a one-line `message`, and often a `hint` with a concrete fix.
`validate()` reports every problem it finds, in a fixed order: structural diagnostics by record
id, then referential ones grouped by check (each group by record id).

## Document level

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_JSON_INVALID` | error | `parseDocument` was given text that is not JSON; the message carries the parser's reason. | Fix the syntax. |
| `FLX_JSON_TOO_DEEP` | error | The JSON nests deeper than 256 levels (`MAX_JSON_DEPTH`); rejected before anything walks it (NFR-REL-002). | Flatten the data. |
| `FLX_DOC_NOT_OBJECT` | error | The input is not a JSON object. | Pass the parsed document object. |
| `FLX_VERSION_INVALID` | error | `schemaVersion` is missing or not `MAJOR.MINOR`. | Set `"schemaVersion": "1.2"`. |
| `FLX_VERSION_UNSUPPORTED` | error | The major version is newer than this reader, or the version is older and was not migrated. | Open with a newer Fluxion, or run `migrate()` first. |
| `FLX_VERSION_NEWER` | warning | A newer minor version: fields and kinds this reader does not know are kept, not interpreted. | None needed. |
| `FLX_RECORDS_INVALID` | error | `records` is missing or not an object keyed by record id. | Store records as `{ "<id>": { … } }`. |
| `FLX_DOCUMENT_MISSING` | error | No record has `type: "document"`. | Add `{ "id": "doc", "type": "document" }`. |
| `FLX_DOCUMENT_DUPLICATE` | error | More than one `document` record. | Keep one. |

## Record structure

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_SCHEMA_INVALID` | error | A record or one of its fields does not match the schema of its type and kind (missing field, wrong type, value out of range, invalid token reference). The path points at the field. | Follow the message; the hint lists allowed values for enums. |
| `FLX_ID_MISMATCH` | error | A record's `id` differs from its key in `records`. | Make them equal. |
| `FLX_RECORD_UNKNOWN_TYPE` | warning | A record `type` this version does not know (newer minor version); kept verbatim. | None, or upgrade. |
| `FLX_KIND_UNKNOWN` | warning | An element `kind` that is neither core nor a plugin `ns:name`; kept verbatim, rendered as a placeholder. | Use a known kind, or a plugin kind. |

## Rich text (ADR-0013)

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_TEXT_INVALID` | error | Broken rich-text structure: a known node in the wrong place, a heading without a level, empty text, nesting deeper than 64 levels. | Follow the path to the node. |
| `FLX_TEXT_UNSAFE_LINK` | error | A link `href` other than `http(s):`, `mailto:` or `#screen:<id>` (NFR-SEC-001). | Use a web or mail link. |
| `FLX_TEXT_UNKNOWN_NODE` | warning | A node type this version does not know; kept and shown as plain text. | None, or upgrade. |
| `FLX_TEXT_UNKNOWN_MARK` | warning | A mark type this version does not know; kept and ignored when rendering. | None, or upgrade. |

## References and structure between records

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_REF_MISSING` | error | A field names a record id that does not exist (`screenId`, `parentId`, `connectorId`, `elementId`, `assetId`, `themeId`, `timelineId`, `ownerId`, `targetId`, …). The hint lists existing ids of the expected type. | Point at an existing record. |
| `FLX_REF_WRONG_TYPE` | error | A field names a record of the wrong type (e.g. `screenId` naming an element, a binding whose `connectorId` is not a connector, a connector bound to itself). | Point at a record of the right type. |
| `FLX_PARENT_INVALID` | error | `parentId` names an element on another screen, or one that cannot contain elements (shape, connector, text, image). | Use a group or frame on the same screen. |
| `FLX_PARENT_CYCLE` | error | Following `parentId` returns to the element. | Break the cycle. |
| `FLX_BINDING_DUPLICATE` | error | Two bindings for the same end of one connector. | Delete one. |
| `FLX_CONNECTOR_END_MISSING` | error | A connector end has no binding and no free point (FR-CON-001). | Add a binding or `freeSource`/`freeTarget`. |
| `FLX_CONNECTOR_END_CONFLICT` | warning | A connector end has both a binding and a free point; the binding wins. | Remove the free point. |
| `FLX_INDEX_DUPLICATE` | warning | Siblings (screens; elements with the same screen and parent; timelines of a screen; steps of a timeline) share an `index`; order between them is undefined until repair appends the later ones. | Give each a distinct key. |
| `FLX_SLUG_DUPLICATE` | error | Two elements share `semantic.slug` (slugs are document-unique handles for FluxScript, AI and MCP). | Rename one. |

## Repair on load

`parseDocument` migrates an older document, then repairs what it can without guessing intent
and reports each change (02-document-model §4). Validation runs on the repaired document.

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_REPAIRED_BINDING` | warning | A binding pointed at a missing connector or element; it was removed and the connector end became a free point (the screen centre when it had none). | Re-attach the end. |
| `FLX_REPAIRED_PARENT` | warning | `parentId` named a missing element or looped; the element moved to the screen root. | Regroup if needed. |
| `FLX_REPAIRED_INDEX` | warning | A sibling `index` was missing, invalid or shared; it was appended after its siblings. | None needed. |

## Styles and themes

Reported by `@fluxion/theme` `resolveStyle` when a style is resolved for rendering (02-document-model
§Style, ADR-0015). Paths point at the style field that holds the reference: into the document
(`/records/<id>/style/fill`), or into the theme's own defaults (`/theme/defaults/<kind>/…`, including
`/theme/defaults/<kind>/variants/<name>/…` and the globals `/theme/defaults/*/…`).

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_TOKEN_CYCLE` | error | The links of a theme's colour tokens (aliases and `mix.with`) return to a token they passed through (`color.a` is `{color.b}` and `color.b` is `{color.a}`), or the chain is longer than 64. `themeDiagnostics` of `@fluxion/theme` reports it with the path of the link; the tokens in the cycle are not emitted. | Make one token in the cycle a literal colour. |
| `FLX_TOKEN_TRANSFORM` | error | A derived colour token's `dev.fluxion` transform is malformed: not a non-empty list of steps, a step with other than one operation, an unknown operation, a number outside 0 to 1, a `mix` without an alias `with`, or a colour that cannot be derived from (a named colour, `lab()`, `lch()`, `hwb()`, `color()`). The token is not emitted. | Use `lighten`, `darken`, `alpha` or `mix` with numbers from 0 to 1, over a hex, `rgb()`, `hsl()`, `oklch()` or `oklab()` colour. |
| `FLX_TOKEN_UNKNOWN` | warning | A style or a theme default names a token the theme does not have (`{color.nope}`); the field falls back through the next layers: the variant defaults, the kind defaults, the theme globals, then the built-in fallback. | Use a token of the theme, or a literal value. |

## Engine

Reported by `@fluxion/core` while plugins and built-ins register or commands run (03-core-engine).
Paths point into the engine (`/registries/<name>/<key>`), not into the document.

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_REGISTRY_DUPLICATE` | error | A key is already registered by another source (plugin); the first registration stays (FR-EXT-001). | Rename the key or namespace it `<plugin>:<name>`. |
| `FLX_COMMAND_UNKNOWN` | error | No command is registered under the id (`/commands/<id>`). | Check the id; load the plugin that provides it. |
| `FLX_COMMAND_DISABLED` | error | The command's `when` is false in the current context; nothing ran. | Change the selection or state it needs. |
| `FLX_COMMAND_ARGS` | error | An argument does not match the command's schema (`/args/<path>`); nothing ran. | Fix the argument the path names. |
| `FLX_READ_ONLY` | error | The store's policy is read-only; no transaction or command runs (ADR-0014). | Open the document for editing, or fork it. |
| `FLX_ORIGIN_RESERVED` | error | A transaction asked for origin `undo` or `redo`, which only the history module replays with (they skip hooks and history); nothing was written (ADR-0014). | Use `user`, `system` or `remote`; undo through `store.history`. |
| `FLX_FORK_UNRELATED` | error | `applyFork` was given a store that is not a fork of the target; nothing was written (ADR-0014). | Apply a fork to the store it was forked from. |

## Expressions

Reported by `@fluxion/core` when it evaluates the expressions of a shape definition (ADR-0016): outline
templates now, bindings later. Paths point into the definition (`/outline/path`, `/outline/polygon/x`).

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_EXPR_SYNTAX` | error | The expression does not parse (an unexpected character or token, a missing parenthesis, the wrong number of arguments, more than 2 000 characters or 64 levels of nesting). | Fix the expression the message quotes. |
| `FLX_EXPR_UNKNOWN` | error | A name or function the expression uses is not defined: only `w`, `h`, the definition's params, `i`, `n`, `pi` and the listed functions are. | Declare the param, or use a listed function. |
| `FLX_EXPR_DOMAIN` | error | A division or modulo by zero, or a result that is not a finite number (`sqrt(-1)`, an overflow). | Guard the value, e.g. with `max(x, 1)`. |
| `FLX_EXPR_BUDGET` | error | The evaluation used up its step budget (an outline and its decorations share one); nothing more was computed. | Simplify the definition, or lower a vertex count. |

## Shape definitions

Reported by `@fluxion/core` when it validates a shape definition (`parseShapeDef`) or evaluates its
outline (`evaluateOutline`, ADR-0016). Paths point into the definition. Validation also parses every
template and expression and checks the names each may read, reporting them with their own codes
(`FLX_SHAPE_PATH`, `FLX_EXPR_SYNTAX`, `FLX_EXPR_UNKNOWN`), so a definition that validates evaluates.

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_SHAPE_DEF_INVALID` | error | The definition breaks its schema: a missing or mistyped field, a param name that is not an identifier or shadows `w`, `h`, `i`, `n`, `pi`, a default outside its range, an outline or handle naming a param of the wrong type. | Fix the field the path names. |
| `FLX_SHAPE_PATH` | error | A path template is not one subpath of absolute `M L H V C Q A Z` commands: a relative or unknown command, a missing or extra number, a second `M`, or a command after `Z`. | Write absolute commands, one `M` first, `Z` last if closed. |
| `FLX_SHAPE_LIMIT` | error | An outline exceeds a cap: a polygon's `n` is not an integer from 2 to 1 024, a template expands to more than 1 024 segments, an element's points list has more than 10 000 vertices, or a coordinate overflows the number range once combined (a control point between `-1e308` and `1e308`). | Lower the count, or keep the numbers smaller. |

## Packs

Reported by `@fluxion/sdk` when a host registers a pack (`pack.register(registries)`, ADR-0017).
A pack registers everything or nothing; definition problems are reported at `/shapes/<n>/…` with
the codes of shape definitions (`FLX_SHAPE_DEF_INVALID`, and `FLX_SHAPE_PATH`, `FLX_EXPR_SYNTAX` or
`FLX_EXPR_UNKNOWN` for templates and expressions), and a key another source holds is
`FLX_REGISTRY_DUPLICATE`.

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_PACK_INVALID` | error | The pack id is not lower-case letters, digits and `-`, or a definition's id is outside the pack's namespace (`<pack>:<name>`). | Rename the pack or the definition. |

## Command line

Reported by `fluxion` (ADR-0147) in its `--json` output and on stderr. Paths point into the
command line, not into a document: `/argv/<index>` names one argument, `/argv` the command line as a
whole (an option parse error, a file that cannot be read); an internal error has the empty path.

| Code | Severity | Meaning | Typical fix |
|---|---|---|---|
| `FLX_CLI_USAGE` | error | The command line is not understood: an unknown command, an unknown or malformed option, or a missing argument; nothing ran, and the exit code is 2. | Run `fluxion --help` or `fluxion <command> --help`. |
| `FLX_CLI_IO` | error | A file the command line names cannot be read or written (missing, a directory, no permission); the exit code is 1. | Check the path and its permissions. |
| `FLX_CLI_INTERNAL` | error | The command failed for a reason that is not the input's: an exception, a command not available in this build, or a reply outside its own schema; the exit code is 3. | Report it with the command line and the input. |
