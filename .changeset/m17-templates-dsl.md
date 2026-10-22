---
'@fluxion/dsl': minor
'@fluxion/cli': minor
---

FluxScript `template:` with `items:` and `options:` on a screen builds the template's pinned shapes and connectors; `decompile` writes them back; the AI catalog lists the templates, and the patch `setLayout` takes `{ type: template, id, items, options? }` (FR-LAY-014, ADR-0047).
