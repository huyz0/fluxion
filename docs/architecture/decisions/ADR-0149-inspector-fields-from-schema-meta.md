---
status: accepted
date: 2026-10-02
decision-makers: harness (M7.15; within FR-EDT-008, FR-EXT-001)
---

# ADR-0149 — The inspector's fields come from the Zod schemas' `.meta`

## Context and Problem Statement

FR-EDT-008 asks for an inspector that shows the properties of the selection, mixed where several
elements differ, and applies a change to all of them. 04 §3.4 already chose to generate it from the
schemas. This ADR fixes the contract that makes generation possible, because plugins will write the
same metadata for their own kinds and an agent will read it.

## Decision

- A field is editable by hand when its Zod schema carries `.meta({ ui, group?, order?, label? })`.
  `ui` is the widget (`number`, `slider`, `text`, `toggle`, `select`, `paint`, or a plugin's own name),
  `group` the section, `order` the position in it, `label` the text (default: the last path segment).
  A field without a `ui` is not shown: the schema opts fields in, so internal and structural fields
  (`id`, `index`, `screenId`) never appear by accident.
- `@fluxion/schema` exports `describeFields(schema)` (walks an object schema, optional and nullable
  wrappers included, a field with `ui` being a leaf: a `paint` is one field) and `elementFields(kind)`
  (a core kind's fields, a qualified plugin kind the plugin element's, an unknown kind none). Enum
  options and numeric bounds are read from the schema, so a widget needs no second source.
- The editor's model (`inspect`, `applyField`) is pure and widget-free. A multi-selection shows the
  fields every element has with the same path and widget; a value is shared when all agree, and
  `mixed` otherwise (including some set and some not). Applying a value is one `element.updateMany`,
  so one undo step whatever the selection; an undefined value removes the field.
- A plugin replaces or edits the fields of its kind with an `inspectors` entry (a function from the
  schema's fields to the fields to show), the path built-in kinds could take as well.

## Consequences

- Adding an editable property is one `.meta` in the schema; the inspector, the command palette and
  the MCP tool descriptions can all read it.
- The `ui` vocabulary is a contract: renaming a widget is a change to plugins' metadata.
- Token references and the picker for them are the widgets' work (M7.16); the model carries values
  as stored, whatever their shape.
