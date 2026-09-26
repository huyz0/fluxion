# .harness — autonomous loop state

| Path | Tracked | Purpose |
|---|---|---|
| `state.json` | yes | Machine-readable loop state (see schema below). Updated in each task commit. |
| `progress.md` | yes | Append-only session log, ≤ 10 lines per entry (skill `brevity`). Rotated per milestone into `progress-archive/M<n>.md`. |
| `baselines/review-argued.txt` | yes | Review findings argued rather than fixed: `<TaskID> <FindingID>: <argument>` |
| `reviews/` | yes | Milestone-review verdicts `M<n>-<checkpoint>.json` |
| `review/` | **no** | Per-commit verdicts `<sha256>.r<round>.json` bound to the staged diff |
| `tmp/` | **no** | Packets, verdict drafts |
| `artifacts/` | **no** | Screenshots/traces from `ui-check` |

## `state.json`

```json
{
  "milestone": "M0",
  "currentTask": null,
  "attempts": 0,
  "reviewRound": 0,
  "loopActive": false,
  "blockedReason": null,
  "updated": "2026-09-26"
}
```

- `loopActive` — set true by `drive` when running under a goal; read by the optional
  `stop-check.mjs` Stop hook.
- `blockedReason` — set on any stop condition; a human clears it.
- `attempts` — consecutive failed fix attempts on the current cause (stop at 3).
