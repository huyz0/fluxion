# Skills

Canonical, tool-agnostic procedures written to the [Agent Skills](https://agentskills.io) spec.

- **Codex** reads `.agents/skills/` natively (`$drive`, `/skills`).
- **Claude Code** reads `.claude/skills/`, which is **generated** from here by
  `node scripts/harness/sync-skills.mjs` (copies frontmatter + a pointer body). Never edit
  `.claude/skills/` by hand; `sync-skills.mjs --check` fails on drift (pre-commit).
  Generated copies instead of symlinks because Windows symlinks need Developer Mode.

## Progressive disclosure

| Layer | What | Loaded |
|---|---|---|
| 0 | `AGENTS.md` (index) | every session |
| 1 | each skill's `description` | every session |
| 2 | a skill body | when invoked |
| 3 | standards, architecture, research, requirements | only when a skill/task says so |

A `description` must say **when to use** the skill, not what it is.

## Rules (enforced by `scripts/gates/check-portability.mjs`)

1. Frontmatter has `name` (= directory name, lowercase-hyphen, ≤ 64 chars) and `description`
   (≤ 1024 chars). Optional: `metadata`. No vendor-only keys here — Claude-only keys
   (`disable-model-invocation`, `context`, `allowed-tools`) live in
   `scripts/harness/skill-adapters.json` and are merged into the generated adapter.
2. No vendor-specific syntax in `AGENTS.md` or any `SKILL.md` (`@import`, `$ARGUMENTS`,
   `!\`cmd\``, tool names like `Bash(`/`TodoWrite`). Skills call **scripts**, never built-ins.
3. Names never collide with built-in commands of either tool: `goal, plan, review, init, loop,
   compact, status, model, skills, agents, help, clear, config, memory, resume, diff`.
4. Body ≤ 150 lines. A skill is a procedure; rationale lives in standards.
5. Every script a skill names must exist, or the skill must say which milestone creates it.

## Skills

See the table in [`AGENTS.md`](../../AGENTS.md#skills) (generated between index markers).

| Lifecycle | Skills |
|---|---|
| Plan | `plan-milestone` → `spec` → `adr` |
| Build loop | `drive` ⟲ (`next-task` → `tdd` → `ui-check` → `verify` → `code-review` → commit) |
| Outer loop | `milestone-review` |
| Support | `research`, `brevity`, `ship` |
