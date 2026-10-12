---
'@fluxion/dsl': patch
---

The stream compiler recognises quoted top-level keys after the screens (`"uses":`, `'title' :`): they trigger the whole-input recompile at `end()` like bare ones, so the streamed document equals the whole-file compile (FR-AI-010).
