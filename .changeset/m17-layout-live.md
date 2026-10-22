---
'@fluxion/schema': minor
'@fluxion/format': patch
---

A layout spec's `live` (ADR-0046, FR-LAY-010): `LayoutSpec` takes an optional `live: boolean` (re-lay the container out automatically after edits; the schema only stores it), with schema 1.6 and a `1.5 → 1.6` migration that drops a non-boolean `live`. The lean reader also opens 1.5.
