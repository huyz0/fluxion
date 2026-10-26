# M18.86 — Visible quick latency target

User authorization (2026-10-25): make gates reasonable, distinguish correctness/security from advisory performance. NFR-DX-002, NFR-DX-003, NFR-MNT-004. Amend only quick elapsed-time enforcement; every quick command, test selection, staged/CI check, coverage floor and test timeout remains unchanged.

M18.85 controlled quiet-machine evidence: quick subchecks passed,193112ms tests,200289ms total versus180000ms target; worst-case staged417311ms versus900000ms hard limit. Manifest changes selected2766tests/533files including382Chromium cases. Prior224783ms overrun and controlled200289ms overrun remain old-policy failures, not retroactive passes. Feature work is preserved in another worktree; no feature qualification follows from this policy decision.
