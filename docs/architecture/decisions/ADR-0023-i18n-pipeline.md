---
status: accepted
date: 2026-10-03
decision-makers: harness (M9.3; within NFR-I18N-001 and tech-stack.md §1; a runtime dependency for the editor and studio, none for the player)
---

# ADR-0023 — The i18n pipeline: Lingui, with macros transformed and messages extracted by the native tools, never by Babel

## Context and Problem Statement

NFR-I18N-001 asks for every UI string to be externalised as ICU messages, English as the default, with a lint rule that
forbids string literals in the editor's JSX (with an allowlist). tech-stack.md names Lingui ("compile-time extraction, small
runtime") and says the build has "no Babel anywhere" (ADR-0008: Vite 8 with Oxc). Lingui's own CLI and Vite plugin run the
macro through Babel. M9 must put the pipeline in place without breaking that rule, decide the catalog layout, the lint and
its allowlist, what the runtime is in each package, and how strings that are not JSX (command titles, menu and palette
text) are translated.

## Decision Drivers

- No Babel in our build, dev server, tests or extraction.
- The player gains no dependency it does not need (a player dependency needs an ADR; it currently has no UI strings).
- `@fluxion/core` and the other pure packages stay free of any i18n library and of English-only UI assumptions.
- Extraction must be a check: the catalog in the tree equals what the source says, or `pnpm verify` fails.
- Strings are found by tools, not by convention: a literal added to JSX fails a gate.

## Considered Options

1. **`@lingui/cli` and `@lingui/vite-plugin` as documented.** They need `@babel/core` and the Babel macro plugin (the
   CLI bundles Babel; the Vite plugin peers on `@rolldown/plugin-babel`). That is Babel in the build.
2. **Lingui's runtime with its native tools.** `@lingui/native-tools` (MIT, a Rust and SWC binary with prebuilt packages
   for every OS the CI uses) exposes `transform(code, filename, options)`, the macro compiled to runtime calls, and
   `extractMessages`/`extractMessagesFromFiles`. A small repository Vite plugin and an extraction script use them; the
   catalogs are a plain format we own. Verified on the three macro forms (`t`, `<Trans>` with elements, `msg`).
3. **Another library (i18next, FormatJS).** Different message model; the standard names Lingui.
4. **No macro: hand-written ids and `i18n._`.** Loses compile-time extraction and the id-from-message guarantee.

## Decision Outcome

Option 2.

- **Transform.** `tools/vite-lingui` (a repository plugin, `enforce: 'pre'`) runs `@lingui/native-tools` `transform` on a
  module that imports a Lingui macro (`@lingui/core/macro`, `@lingui/react/macro`) and leaves every other module to Oxc
  (TypeScript, React Compiler). The same plugin is in the Vite configs of `apps/studio` and `packages/editor` (Storybook)
  and in the Vitest config, so tests see what users see. `descriptorFields` is explicit (`all` in development and tests,
  `id-only` in production builds).
- **Extraction.** `scripts/i18n/extract.mjs` (`pnpm i18n:extract`, with `--check`) runs `extractMessagesFromFiles` over the
  source of the packages that have UI, merges what it finds into the catalogs, and with `--check` exits 1 when a catalog
  differs from the source (a new, changed or removed message). `@lingui/cli` is not installed. `@lingui/native-tools` peers on `@lingui/conf` (^6, Babel-free), which is added as a
  development dependency beside it, and `@lingui/message-utils` (the compiler) likewise.
- **Catalogs.** `packages/editor/src/locales/<locale>/messages.json` (and `apps/studio/src/locales/...`): one object keyed
  by message id, each `{ message, comment?, origin }` with `message` in ICU MessageFormat (placeholders, plurals,
  selects), keys sorted, so a diff shows exactly the messages that changed. Only `en` exists in M9; other locales and
  right-to-left layout are M32. The build compiles a catalog to function-catalog modules with `@lingui/message-utils`
  (`compileMessage`) in the same plugin; the ICU parser is not shipped in production.
- **Runtime.** `@lingui/core` (`i18n`) and `@lingui/react` (`I18nProvider`, `Trans`, `useLingui`) as dependencies of
  `@fluxion/editor` and `apps/studio` (MIT). **The player takes no i18n dependency in M9**: it draws no UI string of its
  own, and `check-i18n` covers its JSX anyway. When the player gains chrome strings (M11), it may use `@lingui/core` only
  (no React bindings), inside `PLAYER_CORE_GZIP`, and the row that adds it records the size; `@lingui/core` is not
  Babel-free in `node_modules` (see above) but nothing of the Babel plugin reaches the player bundle.
  `@lingui/core` and `@lingui/react` both declare `@lingui/babel-plugin-lingui-macro` (a Babel plugin package, with
  `@babel/types`) as a dependency; nothing of ours imports it or Babel, nothing of it is bundled into any app, and
  `check-licenses` and `knip` see it as the transitive packages it is. That is "no Babel" in our pipeline, not "no Babel
  package in `node_modules`"; ADR-0008's rule is about the build toolchain.
- **Non-JSX strings.** Core stays free of i18n: a command's `title` in `@fluxion/core` is its default English text. The
  editor translates a command title by id: the catalog key is `command.<command id>` with the core title as its `message`,
  and `scripts/i18n/extract.mjs` generates those entries from the command registry, so a new command appears in the
  catalog by extraction. Other non-JSX text in the editor (menu lines, palette labels, diagnostics shown to people) uses
  the `msg` macro and `i18n._(descriptor)`.
- **Lint.** `scripts/gates/check-i18n.mjs` parses every `.tsx` of the packages with UI with the TypeScript compiler API and
  fails on a JSX text child, or a string literal in `aria-label`, `title`, `placeholder`, `alt` or `label`, that is not
  inside a Lingui macro call. The allowlist is a reviewed file (`scripts/gates/i18n-allowlist.json`: path globs for tests,
  stories and fixtures, and exact `file:text` entries for strings that are not for people, with a reason each); a literal
  that is purely symbols, digits or whitespace is exempt. A negative fixture proves a literal fails.
- **Tests.** `i18n.activate('en')` in the editor test setup; a T1 test renders the editor and checks its English messages;
  a pseudo-locale (`en-XA`, generated from `en` by the extraction script, not committed) is available to tests that need
  to prove nothing is hard-coded.

### Consequences

- Good: no Babel anywhere in our pipeline; the transform and the extractor are native and fast; the catalogs are plain
  JSON that review reads.
- Good: core and the other pure packages stay free of i18n; command titles are translatable without a dependency.
- Neutral: `@lingui/native-tools` is pre-1.0 (0.1.x): its API may change before 1.0, so it is pinned and the plugin and
  script are the only two callers.
- Bad: we own a small Vite plugin, an extraction script and a catalog format that Lingui's CLI would otherwise provide.
- Bad: the editor and studio gain two runtime dependencies (`@lingui/core`, `@lingui/react`); the editor bundle grows by
  their runtime and the compiled catalog (budgeted by `size-limit`).

### Confirmation

- T0 "NFR-I18N-001: a JSX string literal outside the allowlist fails check-i18n" with a negative fixture (M9.19).
- `pnpm i18n:extract --check` is a leg of the M9 gate and a step of `pnpm verify`; a changed message without a catalog
  update fails it.
- T1 "NFR-I18N-001: the editor renders its English messages" (M9.20).
- `check-licenses`, `knip` and `size-limit` pass with the new dependencies; no `@babel/*` package is imported by any file
  of ours (a grep test).

## More Information

NFR-I18N-001 (30-non-functional), tech-stack.md §1, ADR-0008 (toolchain), ADR-0139 (portable stories run with the same
plugin), the M32 plan (extra locales, right-to-left UI), the M11 plan (player chrome).
