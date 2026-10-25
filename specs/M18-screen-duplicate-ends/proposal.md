# Screen duplication with outside-bound endpoints

FR-SCR-002 and FR-CON-001 already require undoable duplication and complete connector ends.
A real-store cross-screen fixture loads successfully but its duplicate fails with
`FLX_CONNECTOR_END_MISSING` after the outside binding is excluded. M18.62 preserves that
failure as a separate finding; it did not claim to fix it.

[ADR-0175](../../docs/architecture/decisions/ADR-0175-screen-duplicate-external-ends.md)
chooses caller-resolved free points, following existing clipboard behavior and core purity.
No requirement, file format, dependency, license policy, threshold or retry limit changes.

Acceptance:

- WHEN a selected connector has an outside-bound end, duplication SHALL use its supplied finite
  screen-local point as a free end while preserving internal binding remapping and existing free ends.
- WHEN a required point is missing, duplication SHALL refuse before writing with the exact argument
  path and no notifications; malformed supplied points SHALL fail schema validation.
- WHEN duplicated through the navigator, the editor SHALL supply the existing route's exact endpoint
  point, including non-centre anchors, and switch screens only after success.
- Successful duplication SHALL preserve originals, transaction order, and exact undo/redo.
- Legacy internal-only arguments SHALL remain valid; whole-source mutation scope and floors SHALL remain.
