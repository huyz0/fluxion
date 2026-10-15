---
'@fluxion/layout': minor
---

M13.15, the arrange command (FR-LAY-005): `registerArrangeCommand(commands, layouts)` adds `layout.arrange` (`arrangeCommand`, `ARRANGE_COMMAND_ID`) to a host's commands. It lays out a screen, a selection (the rest of the screen stays put and is avoided) or a container (its own layout spec applies) with a registered algorithm, nested containers bottom-up, and writes the new `transform` of every element that moved in one transaction (one undo step).
