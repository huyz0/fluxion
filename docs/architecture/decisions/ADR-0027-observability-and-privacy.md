---
status: accepted
date: 2026-10-04
decision-makers: harness (M11.4; within NFR-OBS-001, NFR-OBS-002, NFR-SEC-006 and architecture/03 §7; no runtime dependency)
---

# ADR-0027 — Observability and privacy: the Logger, the debug overlay, the diagnostic report, and no telemetry

## Context and Problem Statement

M11 needs leveled, namespaced logging with a debug overlay (NFR-OBS-001), a report a person can copy into a bug without leaking their document
(NFR-OBS-002), and a guarantee that nothing leaves the machine unasked (NFR-SEC-006). The `Logger` port exists in core (`log(level, message, fields?)`)
and has no implementation. What does the implementation do, where does it live, and how is "no telemetry" kept true as code grows?

## Decision Drivers

- NFR-SEC-006: no telemetry by default; anything optional is opt-in, anonymous and documented; a network test enforces it.
- NFR-OBS-002: a report with versions, document statistics and errors, and no document content.
- NFR-SIZE-001: the one-file player is at its budget; observability must cost nothing when it is off.
- Layering: `core` is pure and holds only the port; an implementation touches `console` and the DOM, so it sits in a host layer.

## Considered Options

1. **Console only.** `console.*` calls with a prefix. No levels, no way to turn one namespace up, nothing to test.
2. **A pluggable sink that can ship entries to a remote collector.** Flexible; it is a telemetry channel by construction, and every release would need an
   argument that nothing uses it.
3. **A console logger with levels and namespaces, a lazy debug overlay, a copy-only diagnostic report, and a network test.** No remote path exists.

## Decision Outcome

Chosen option: **3**.

- **The Logger.** `createConsoleLogger({ level, namespaces })` lives in `@fluxion/player` (L4, DOM allowed), which the editor and the studio already depend on;
  core keeps only the port. Namespaces are `fluxion:<area>` (`render`, `route`, `store`, `file`, `player`). Levels are `debug`, `info`, `warn`, `error`; the
  default is `warn`. A level or a namespace is raised by `localStorage['fluxion:log']` (for example `fluxion:route=debug`), by `?log=` on the page, or by the
  host passing options; nothing else reads them. The sink is `console` only; there is no other sink and the logger imports no network API.
- **The debug overlay.** Off by default and loaded with `import()` the first time it is toggled, so its code is not in the one-file player's core. The shortcut is
  `Ctrl/Cmd+Alt+D`. It shows frames per second (an average over the last second of `requestAnimationFrame` deltas), render counts per view kind (from a counter
  hook in `render`), and routing timings (from the router's `performance.measure` marks). Nothing runs while it is closed.
- **The diagnostic report.** "Copy diagnostic report" (in the studio's menu and in the overlay) writes one JSON text to the clipboard and sends it nowhere. It holds:
  the application, format and schema versions, the browser's brand and major version, counts (screens, elements by kind, assets and their total bytes, fonts),
  the feature flags in force, and the last 20 errors as **a code and a module, never the message text** (messages can quote content). It holds no title, text,
  name, URL, asset name or any string taken from a document.
  The errors come from one place: a ring buffer inside the console logger, fed by every `log('error', ...)` entry. The entry's `namespace` is the module; its
  `fields.code` is the code when it matches `^[A-Z][A-Z0-9_]{2,40}$` (the schema's `FLX_*` diagnostics and the uncoded-prefix codes such as `HISTORY_EMPTY`,
  `TX_INVALID`, `TX_READ_ONLY` and `GOOGLE_URL`), and `UNCODED` otherwise; the message and every other field are not stored. A host catches at its boundaries (the studio
  shell, the player's mount, the file open and save paths) and logs there with the error's `code` if it has one, so a thrown error that carries no code is
  reported as `UNCODED` under its namespace and nothing of its text. A sentinel test fills a fixture with unique strings, raises errors whose messages and fields carry
  them through the logger, and requires none of them in the report.
- **No telemetry.** No code path makes a request the person did not ask for. The requests the product does make are user-initiated (opening `?src=`, the font
  catalogue the person opens, a file picker). A Playwright test records every request across a whole edit, save and present session and fails on any host other
  than the page's own origin (`file:`, `data:`, `blob:` and localhost included only as such). The session opens one file with a same-origin `?src=` (a
  cross-origin `?src=` is user-initiated too, and the test would allow exactly the one URL it supplied and nothing else); the Google Fonts routes are not opened in
  that session because the person did not open them. If an opt-in, anonymous channel is ever wanted it needs its own ADR, an off switch shown in the settings, `docs/privacy.md` updated, and the
  test given an explicit allowance.
- `docs/privacy.md` states all of the above in plain words for people.

### Consequences

- Good: logging and the overlay add nothing to the player's core while off; the report is safe to paste into a public issue; the network test turns "no telemetry"
  from a promise into a failing test.
- Bad: error text is not in the report, so a bug sometimes needs a second question to the reporter (the code and module usually suffice).
- Bad: a logger that cannot send anywhere cannot be used for field diagnostics; that is the point.
- Neutral: the `Logger` port keeps its shape; the implementation is replaceable by a host (tests pass a capturing logger).

### Confirmation

T0 tests of the logger's levels and namespaces (`NFR-OBS-001: the logger honours its level and namespaces`); a browser test that the overlay toggles from its shortcut and
costs nothing closed (`NFR-OBS-001: the overlay toggles from its shortcut`); the sentinel test of the report (`NFR-OBS-002: the report holds no document text`); and
`e2e/privacy.no-telemetry.spec.ts`, which `m11-complete` runs on three engines.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Console only | trivial | no levels or namespaces, nothing testable |
| Pluggable remote sink | flexible | a telemetry channel by construction |
| Console logger, lazy overlay, copy-only report (chosen) | useful and safe, costs nothing off | a second question to the reporter now and then |

## More Information

Related: architecture/03 §7 (ports), ADR-0017 (hosts), ADR-0026 (the player's core and what is lazy). Rows: M11.21 (the logger and overlay), M11.22 (the report,
the network test and `docs/privacy.md`).
