---
'@fluxion/core': minor
---

Commands take `CommandTxOptions` and refuse the history origins with `FLX_ORIGIN_RESERVED`; history replays through a private path; forks refuse unrelated stores (`FLX_FORK_UNRELATED`).
