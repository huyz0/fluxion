---
"@fluxion/format": minor
"@fluxion/cli": patch
---

The member rules, witness-session rotation and declared-credits rules of an SVG pack import move from `fluxion pack-import` to `@fluxion/format` (M18.174), so the studio can share them: `zipMembers`, `INPUT_LIMITS`, `slugOf`, `categoryOf`, `memberIds`, `escapes`, `witnessSessions` (the host injects the clock), `parseImportCredits`, `withNotices` and `scopedCredits`. `pack-import` behaves as before. Migration: none.
