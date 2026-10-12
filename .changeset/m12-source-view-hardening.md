---
'@fluxion/editor': patch
---

The Source view is hardened (FR-EDT-022, FR-DSL-009): a screen switch or unmount flushes the waiting text to the screen it was typed on and drops it, with a status, when that screen was deleted on the canvas; nothing is applied while an IME composes; the reload banner clears when the canvas comes back to the text; the status line names unpaired connector twins by their ends and puts slug, meta and params conflicts in words; completion scans back from the cursor in linear time on very long lines; the left tab strip no longer wraps to two rows.
