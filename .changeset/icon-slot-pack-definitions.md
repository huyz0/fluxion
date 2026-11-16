---
'@fluxion/editor': minor
'@fluxion/format': patch
---

An icon slot filled from the inspector loads the definition it names through the host's catalog first (`InspectorFieldsProps.ensureDef`), so a first-party pack icon that nothing has loaded yet draws and is saved with the file (FR-SHP-007, FR-LIB-009).

The portable save embeds a pack definition an icon slot names even when no shape uses it as its own.
