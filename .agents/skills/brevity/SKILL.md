---
name: brevity
description: Write reports, progress entries, commit bodies and review findings without preamble, recap or narration while keeping every load-bearing detail. Use whenever producing text another agent or a human will read later.
---

# Brevity

1. Lead with the result: what changed / what failed / what is needed.
2. Keep evidence verbatim and complete: IDs, file:line, command + exit status, numbers.
3. Cut: restating the task, narrating steps ("First I…"), hedges, praise, summaries of summaries.
4. One idea per line; tables for ≥ 3 parallel items.
5. Progress entries (`.harness/progress.md`) ≤ 10 lines:
   ```
   ## 2026-10-02 M5 session 3 (claude)
   done: M5.3 (a1b2c3d), M5.4 (e4f5a6b)
   gate m5: 6/9 — red: connectors-e2e, markers-visual, trace
   next: M5.5 marker rendering
   blocked: —
   ```
6. Never shorten a review finding's `failure_scenario` or drop a number to save words.
