# Library SVG import (M18.17)

FR-LIB-004: a user imports SVGs (one file, several, or a ZIP) from the library panel and gets usable
shapes, optionally colorized to theme tokens. M18.16 gave the CLI transaction (ADR-0206); nothing in
the studio reaches it, and `e2e/library.import-svg.spec.ts`, which the M18 completion leg runs in
Chromium, Firefox and WebKit, does not exist.

WHEN a user picks the 50-SVG corpus as a ZIP under **Import SVG…** in the library panel, with the
credits file that declares each member's rights (the CLI's `--credits` format: one upstream credit
per Lucide member pinned to its declared hash, one original credit for the Fluxion members), and
confirms, THE SYSTEM SHALL convert every member under the browser's own paint witness, register 50
shapes of at least 4 anchors each under one new namespace, list them in the library, insert a picked
one, and keep the pack so a save and reopen draws it. IF any member is refused (not an SVG, not
painted, an escaping or colliding name, a cap passed, an uncredited member, an unpermitted license,
a namespace already held) THEN THE SYSTEM SHALL register nothing and list each refusal with its
member path. WHEN the user maps a literal color the batch uses to a theme color token THE SYSTEM
SHALL re-witness with the mapping and draw that color through the token, following a theme change.

Rights are declared, never inferred or computed (ADR-0206): a credits file, or the one-credit form
for the user's own work (`original`, with its license, attribution and author typed; no default
license). An upstream source in the one-credit form needs
its hash typed by the user, as `--upstream-sha256` does.

Scope: the member rules and session rotation shared with the CLI (M18.174, a move), the editor
importer (M18.175), the panel dialog, studio wiring, the save and the three-browser e2e (M18.17).
Not in scope: draw.io and Iconify import UI, other font profiles (M18.48/39/40), partial imports.
