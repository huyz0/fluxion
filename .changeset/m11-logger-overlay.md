---
'@fluxion/core': minor
'@fluxion/render': minor
'@fluxion/editor': minor
'@fluxion/studio': patch
---

A structured logger with levels and namespaces (`createLogger`, `consoleSink` in core; the studio reads its level and filter from the address), and a debug overlay in the editor, toggled with Ctrl or Cmd+Shift+D, showing the frame rate, render counts and connector route timings (`RenderStatsContext` in render) (NFR-OBS-001).
