# .codex — Codex adapter (thin)

| File | Purpose |
|---|---|
| `config.toml` | Enables hooks (`[features] hooks = true`); documents the optional Stop hook |
| `hooks.json` | `PostToolUse` on `apply_patch` → quick gate (same command as `.claude/settings.json`) |

Codex reads `AGENTS.md` and `.agents/skills/` natively — no adapter files are needed for them.

**One-time trust:** Codex runs project-layer config and hooks only after you trust the project
`.codex/` layer, and re-asks when a hook's content hash changes. Hooks configured repo-locally
have been reported not to fire in some interactive versions (openai/codex#17532) — if the quick
gate never appears after an edit, check `codex --version` and the trust prompt.

Source: Codex hooks documentation (learn.chatgpt.com/docs/hooks), checked 2026-09-26.
