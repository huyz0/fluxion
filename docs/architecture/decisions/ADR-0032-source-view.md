---
status: accepted
date: 2026-10-07
decision-makers: harness (M12.4; adds editor-only dependencies, a tech-stack row; within FR-EDT-022 and FR-DSL-009, no requirement changes)
---

# ADR-0032 — Source view: CodeMirror 6 in a lazy chunk, the Lezer YAML grammar with a FluxScript layer, a TextMate grammar, screen-scoped two-way sync

## Context and Problem Statement

FR-EDT-022 asks for a Source view that shows and edits the current screen as FluxScript, with two-way sync: an edit in the text updates the canvas, and an edit
on the canvas updates the text. FR-DSL-009 asks for syntax highlighting (a TextMate grammar for other editors) and for completion of shape ids, tokens and
element refs. The editor has no code editor today, and its initial bundle has a budget (`EDITOR_INITIAL_GZIP`, 600 kB gzip). Two-way sync can loop, clobber
the author's text or flood the undo stack (the M12 plan's risk table). Which editor component do we use, what grammars, and how does sync work?

## Decision Drivers

- FR-EDT-022, FR-DSL-009. NFR-SIZE-002: the editor's initial load and time to interactive.
- Licences: MIT/ISC/BSD only for editor dependencies (`check-licenses`).
- No regression for authors: their text is never replaced while they type. One applied change is one undo step (ADR-0014).
- One FluxScript tokenizer: the highlighting must not drift from the compiler.

## Considered Options

1. **Monaco.** It is VS Code's editor and has TextMate grammars through `vscode-textmate` and Oniguruma (wasm). It is several MB, loads workers, and is hard to
   theme into the editor chrome.
2. **CodeMirror 6** (MIT): modular, about 150 kB gzip for state, view, language, autocomplete, lint and YAML. It uses Lezer grammars, not TextMate.
3. **A plain `<textarea>` with an overlay** for highlighting. It is tiny, but it has no completion UI, no gutter and poor accessibility for long text.

For the grammar under CodeMirror:

- **(a) An own Lezer grammar for FluxScript.** YAML's indentation rules need an external tokenizer, which is a parser of its own to maintain beside the
  compiler's.
- **(b) `@codemirror/lang-yaml`** (the Lezer YAML grammar, MIT), plus a FluxScript layer: decorations that mark edge ops, slugs, anchors and shape ids using
  `@fluxion/dsl`'s own edge tokenizer and key table (ADR-0030).

## Decision Outcome

Chosen option **2 with grammar (b)**.

### Components and loading

- Dependencies, editor only: `@codemirror/state`, `view`, `commands`, `language`, `autocomplete`, `lint`, `lang-yaml`, and `@lezer/highlight`. All are MIT,
  and their licences are recorded in the commit that adds them. The player never imports them.
- The source view lives in `packages/editor/src/source-view/`. It is the editor's **first lazy chunk**: the Source tab loads it with a dynamic `import()`, and
  `@fluxion/dsl` is imported only from inside that chunk. `editor/dist/index.js` and the chunks it imports statically contain no `@codemirror/`, `@lezer/` or
  `@fluxion/dsl` (the M12.23 gate leg).
- **Grammars.**
  - The **Lezer** grammar is the YAML one from `@codemirror/lang-yaml`. The FluxScript layer adds token classes for edge ops, slugs, anchors and qualified
    shape ids, computed by the dsl tokenizer, so the highlighting and the compiler agree.
  - The **TextMate** grammar `packages/dsl/grammar/fluxscript.tmLanguage.json` is written by hand for other editors (VS Code and GitHub). It extends
    `source.yaml` with the same token classes.
  - Both are checked against every `examples/dsl` file (M12.20): the Lezer tree has no error node, and the TextMate snapshot is stable.
- **Completion** reads the catalog the editor already holds: shape ids from `shapeDefs` (packs included), token names from the theme, and slugs of the
  current document after an edge op.

### Sync

- **Scope.** The view shows the current screen's block, made by the decompiler (M12.16), with the document header read-only above it. Switching screens
  switches the block.
- **Text to canvas.** After **300 ms** with no keystroke (the debounce), the screen block is compiled into the open document (ADR-0031: the base's salt).
  - With no error, the result is applied as **one undo transaction** (`source.apply`). The apply touches only records **the source owns**: those the
    block's decompile produced (they carry a `semantic.slug`, or are edges between slugged ends). The apply is a **three-way merge**. The view keeps the compiled result of
    its **base text** (the text as last regenerated or applied). Only what differs between that base result and the new compile is written: a field the
    author did not change in the text keeps the document's current value, even when the canvas changed it meanwhile. An owned record missing from the new
    compile but present in the base result is deleted. A record the text changed that the canvas also changed since the base is written from the text
    (the author's latest action), and the banner names it. Records the decompiler cannot express (an image, a free rich-text element, anything else outside the v0 subset) are not
    in the block, are never owned, and are kept as they are. The view lists them under the block as read-only comments (`# kept: 3 records not shown`).
    Selection follows the source map, and a renamed slug maps its old id to the new one.
  - With errors, nothing is applied. Diagnostics show in the gutter and the lint panel, and the canvas keeps its last good state.
- **Canvas to text.** When the document changes from anywhere other than the view, the block is regenerated only when the view is **clean**: no pending
  keystrokes, no unapplied text and no errors.
  - A view that is focused, or dirty, is never regenerated by itself. It shows "Canvas changed — reload", and only clicking that replaces the text (the
    author's consent).
  - Blur **flushes** first: pending keystrokes are compiled and applied at once, without waiting for the debounce. Text that does not compile stays in the
    view with its diagnostics, and the banner stays.
  - Regenerating replaces the block as one CodeMirror change that keeps the cursor's slug. It is not a document change, so it cannot loop. It is also an
    entry in CodeMirror's own history, so a reload can be undone inside the view.
- **Undo.** Document undo and redo are the editor's (ADR-0014). CodeMirror's history covers the view's text only (keystrokes and reloads). It is kept for as long as the screen is open.

### Consequences

- Good, because the initial bundle does not grow: CodeMirror and the compiler load on first use of the Source tab.
- Good, because there is one tokenizer, so the highlighting cannot disagree with the compiler.
- Good, because an author's typing is never overwritten, and one apply is one undo step.
- Bad, because the TextMate grammar is a second, hand-written description of the same tokens. The example corpus keeps it honest.
- Bad, because `lang-yaml` knows YAML, not FluxScript structure. Structure errors come from the compiler, after the debounce.

### Confirmation

- `m12-complete`: this ADR's leg (CodeMirror, Lezer, TextMate, debounce, undo); the size and chunk legs (M12.23); the grammars leg (M12.20); the
  completion test (M12.21); and `e2e/source-view.two-way-sync.spec.ts` on three engines (M12.22).
- `check-licenses` passes with the new dependencies.

## More Information

ADR-0030 (grammar), ADR-0031 (ids and salt), ADR-0014 (transactions), ADR-0064 (another editor-only lazy library). Architecture: 04-rendering-and-editor.md,
06-ai-authoring.md. Tech stack: `docs/standards/tech-stack.md` (the "Source view" row).
