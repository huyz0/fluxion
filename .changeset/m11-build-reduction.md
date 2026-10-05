---
'@fluxion/anim': minor
---

Build groups: `compileBuilds` folds a screen's timeline steps into the groups a presentation clicks through (`onEnter` is group 0, a click, event or time step starts a group, with/after-previous steps join it), and `reduceBuild` gives the state after any group from the start, for the `appear` and `disappear` effects (FR-PRS-003). Pure; the other effects arrive in M21.
