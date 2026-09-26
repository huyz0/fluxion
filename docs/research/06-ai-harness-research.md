# 06 — AI Harness Research: oqueue, Goal Loops, Portable Skills

> Status: Research input · Date: 2026-09-26 · Scope: how Fluxion will be built by AI agents
> (Claude Code + OpenAI Codex CLI) with minimal human involvement.
>
> All external material is summarized in our own words. Quotations are avoided; see Sources.

---

## 0. TL;DR

1. **oqueue was found** — it is the user's own repository, `huyz0/oqueue` on GitHub, with a
   local checkout at `E:\work\oqueue` (a Kafka-compatible broker in Rust on S3/GCS). About 578
   commits since 2026-08-13, and nearly all of them were written by agents. Recent commits carry
   `Co-Authored-By: OpenAI Codex`. Its harness is the most useful reference we have. It is a
   **gate-enforced, spec-driven, two-loop system**:
   - An *inner loop* runs per task: next-task → spec check → TDD → deterministic gates →
     isolated review → commit → tick backlog.
   - An *outer loop* runs per milestone: an isolated cross-cutting review → findings become
     backlog rows → re-plan.
   - A milestone ends when its **completion condition exits 0**. The condition is a shell
     command, not a judgement.
2. **There is no `/goal` skill in oqueue.** It used to have one, but task `M-1.36` renamed the
   `goal` skill to `milestone`. The reason was that the tools themselves claim the `/goal` name,
   and a slash-command collision gives no warning. The "goal slash command" workflow is in
   practice this: the **built-in `/goal`** of Codex (≥ 0.128) or Claude Code wraps the repo's
   `milestone` skill.
3. **Portable skills are now standard.** The Agent Skills spec (agentskills.io, opened by
   Anthropic in Dec 2025) defines `SKILL.md` with `name` and `description` frontmatter.
   - Codex reads repo skills from `.agents/skills/`.
   - Claude Code reads `.claude/skills/` (and legacy `.claude/commands/`), but **not**
     `.agents/skills/`.
   - Codex custom prompts (`~/.codex/prompts`) are deprecated in favour of skills, and they
     were never project-scoped.
4. **Recommended harness for Fluxion:**
   - `AGENTS.md` is the source of truth, and `CLAUDE.md` holds only `@AGENTS.md`.
   - Canonical skills live in `.agents/skills/`. Generated thin adapters go in
     `.claude/skills/` (or `.claude/commands/`).
   - The built-in `/goal` in both tools is the loop driver, pointed at a `drive` skill whose
     exit test is `node scripts/gates/<milestone>.mjs`.
   - Deterministic Node-based gates run in git hooks and CI.
   - A hash-bound **cross-model review** (Claude writes, Codex reviews, or the reverse) is
     required before each commit.
   - State lives in files: roadmap, backlog, progress log, and `.harness/state.json`.

---

## 1. oqueue — what it is and where the harness lives

| Item | Value |
|---|---|
| Repo | https://github.com/huyz0/oqueue (local: `E:\work\oqueue`) |
| Product | Kafka-protocol broker in Rust, object storage as the log |
| Age / size | First commit 2026-08-13 (`M-1.0: repo foundation and research corpus`), ~578 commits by 2026-09-26, milestones M-1 … M15 |
| Authors | Agent sessions. Most commits are credited `a`; recent ones are co-authored by OpenAI Codex |
| Premise | Stated as a design position (`docs/researches/21-ai-development-loop.md`, `docs/researches/10-open-questions.md`): **no human reads the code** |

### 1.1 Harness file map

```
AGENTS.md                         layer-0 index loaded by every tool (standards table, skills table,
                                  7 non-negotiables each naming its enforcing script, "Never" list)
CLAUDE.md                         two lines: @AGENTS.md and @.agents/skills/README.md  (the adapter)
<crate>/AGENTS.md                 per-crate context (nearest AGENTS.md adds detail)
.agents/skills/                   canonical procedures, Agent Skills spec
  README.md                       progressive-disclosure rules + skills table
  milestone/  milestone-review/  next-task/  spec/  tdd/  review/
  adr/  contract-change/  research/  brevity/
.claude/commands/<skill>.md       9 thin adapters: "read .agents/skills/<x>/SKILL.md and do it"
.claude/agents/reviewer.md        isolated per-commit reviewer subagent (Read/Grep/Glob/Bash only)
.claude/agents/milestone-reviewer.md   isolated whole-milestone reviewer
.claude/settings.json             PostToolUse hook on Edit|Write → scripts/check-crate.sh | tail -20
.githooks/pre-commit, commit-msg  tracked hooks; delegate to `pre-commit run --hook-stage …`
.pre-commit-config.yaml           the single definition of the gate set (~27 hooks)
.github/workflows/gates.yml       CI runs the same pre-commit config (--all-files)
scripts/check-*.sh                ~30 deterministic gates (review, drift, tests-kept, layering,
                                  sans-io, unsafe, secrets, coverage, mutants, budget, portability…)
scripts/gates/m<N>-complete.sh    one completion-condition script per milestone
scripts/review.sh                 builds review packet, validates & records verdict JSON
scripts/milestone-review.sh       coverage / context / record for the outer loop
scripts/build-index.sh            regenerates the tables between <!-- index:…:start/end --> markers
scripts/docker-test.sh            runs cargo/gates inside a resource-capped container
baselines/*.txt                   argued review findings, mutants, unsafe, conformance matrix
reviews/milestone-*.json          tracked milestone-review verdicts
docs/researches/ (22 docs)        cited research corpus, upstream of product docs
docs/internal/product/            mission, requirements (FR/NFR IDs), architecture, roadmap,
                                  milestones/M<n>.md plans, backlog.md, decisions/ (ADRs, 80+)
docs/internal/standards/ (14)     process / quality / delivery / code standards, each with
                                  a "Read when…" description and named gates
```

### 1.2 Key mechanisms, in our own words

**Progressive disclosure (4 layers).** `.agents/skills/README.md` defines four layers:

| Layer | Content | When it is loaded |
|---|---|---|
| 0 | `AGENTS.md`, kept deliberately as an index | Every session |
| 1 | Skill `description:` lines | Every session |
| 2 | A skill's body | When the skill is invoked |
| 3 | Standards, product docs, research | Only when a skill says to read them |

Descriptions must say *when to use* the skill, not what it is. Each standard's frontmatter has
a "Read when…" line, and a script copies that line into the `AGENTS.md` table.

**Skills are tool-neutral, and adapters stay thin.** The rules are:
- Skills call scripts in `scripts/`, never tool built-ins.
- No vendor syntax may appear in `AGENTS.md` or `SKILL.md`. `@import` is allowed only in
  `CLAUDE.md`.
- `check-portability.sh` enforces both rules.
- Each `.claude/commands/*.md` file is three lines pointing to the skill, because a copied
  procedure would drift from the original.

**Chain of traceability** (`standards/sdd.md`):
- The chain runs requirement (FR/NFR ID) → milestone (completion condition is a command) →
  spec → task (one commit's worth) → commit (subject begins with the task ID) → test (names the
  requirement).
- A requirement nobody can verify is not accepted.
- An NFR without a number is marked **UNDERIVED** and never invented.

**The `milestone` skill (the autonomous loop; formerly `goal`).**
- It first reads `roadmap.md` and refuses to run if the milestone's completion condition is not
  a runnable command.
- It decomposes only the current milestone into `backlog.md`. It re-derives rows from the plan
  in `milestones/M<n>.md` instead of copying them.
- It writes the completion gate script **first, and red**. While the gate's legs fail, they
  state what work remains.
- The loop runs until the completion command exits 0:
  1. next-task
  2. check the acceptance criteria
  3. TDD
  4. deterministic gates
  5. isolated review
  6. fix or argue each finding
  7. commit with the task ID
  8. tick the backlog with the commit ref
  9. rerun the completion condition
- It has explicit **stop conditions**. The loop stops and reports when:
  - a gate still fails after 3 fix attempts;
  - the task needs a human decision;
  - the spec turns out to be wrong;
  - an unplanned core-contract change is needed;
  - the completion gate passes but the milestone is obviously not done (that is a bug in the
    gate);
  - the next step is destructive or visible outside the repo.
- It must never skip review, claim a gate passed without running it, widen scope, or weaken
  thresholds.
- The outer loop ends **by disposition, not by an empty backlog**. Findings that don't reopen
  the milestone are handed to the next one, which is recorded in the "Deferred" table and the
  receiving plan.

**`next-task`** takes the *top* unblocked row, not the most interesting one.
- If the top three rows are all blocked, the skill stops, because that is a planning problem.
- Before starting a row it checks four things: the row cites a requirement, its acceptance
  criteria are checkable, it fits in one commit, and it has not already been done.

**`spec`** has six sections: Requirements, Scope (including what is excluded), Design (with
rejected alternatives), Acceptance criteria, Risks, and Tasks.
- Acceptance criteria must be checkable by a test, a gate, or a bounded number.
- The spec is reviewed before any code is written.
- A spec that turns out to be wrong is amended, and an ADR is written if the change alters an
  approach or a requirement.

**`tdd`** follows red → green → refactor, with these rules:
- Watch the test fail before implementing.
- Test behaviour, not implementation.
- Default to the pure-logic tier with fakes. Needing I/O in a test signals the code is in the
  wrong layer.
- Never use `sleep` or fixed ports.
- Consider scoped mutation testing to catch tests that execute code without constraining it.

**Hash-bound independent review** (non-negotiable 4; doc 21 §4–6).
- `review.sh context --task ID` builds a packet containing:
  - the backlog row, verbatim;
  - the staged diff (or only the delta since the last round);
  - the standards `which-standards.sh` selects from the staged paths;
  - the gates that already passed.
- The packet deliberately leaves out the author's reasoning. Rationale persuades by
  construction, so a reviewer who sees it grades the rationale instead of the code.
- The reviewer runs as an isolated subagent (`.claude/agents/reviewer.md`, or the other tool's
  equivalent). It frames the review adversarially.
- Every finding needs `file:line`, a severity, and a concrete failure scenario.
- `review.sh record` validates the verdict JSON and stores it at
  `target/review/<sha256(staged diff)>.json`.
- `check-reviewed.sh`, a pre-commit gate, recomputes the hash and refuses the commit if no
  matching verdict exists. It also refuses if blocking findings (or majors, on a
  changes-requested verdict) are unresolved.
- Each finding is either fixed (which changes the hash and triggers re-review) or argued in
  `baselines/review.txt`.
- Minor findings go in the commit body, and fixing one does not earn another round.
- Review is capped at about 3 rounds, and going further requires a signed override.
- The docs say plainly what the gate cannot prove: that the reviewer was not the author.
  Isolation comes from the harness, not the script.

**`milestone-review` (outer loop).**
- A fresh agent that did not drive the milestone reads the files as they now stand, not the
  diffs.
- It looks for:
  - drift;
  - contradictions between changes that each passed review;
  - abstractions that should be extracted or collapsed;
  - standards that stopped being followed;
  - the spec itself being wrong;
  - gates that pass for the wrong reason;
  - claims in docs that the code no longer supports.
- Verdicts are **tracked** in `reviews/`, and `check-milestone-review.sh` requires coverage of
  the milestone's commits.

**Allocation rule** (doc 21 §3):
- Anything a script can decide is never delegated to an agent.
- The reviewer's attention goes only to what scripts can't reach.
- A semantic finding that recurs is treated as a bug in the gate set, and the fix is a new
  script.
- Mutation testing counts as the main anti-slop gate, since tests that visit lines without
  constraining them are the typical AI failure.

**Other gates worth noting:**

| Gate | What it enforces |
|---|---|
| `check-commit-msg` | Subject is `<task-id>: …`, and the ID must exist in the backlog |
| `check-tests-kept` | A deleted test needs a `Removes-test:` trailer |
| `check-drift` | Thresholds can't move in the weakening direction |
| `check-budget` | The pre-commit suite must finish under a 10 s ceiling |
| `check-milestone-exit` | A milestone can't start without its exit test |
| `check-milestone-handoff` | Deferred findings must actually be recorded with their receiver |
| `check-file-size` | Size limits of roughly 500 lines per file and 50 per function |
| `build-index.sh --check` | Generated index tables are current |

**Self-verifying documentation.**
- Sentences in docs like "every script the standards name exists" are checked in *both*
  directions by `check-portability.sh`.
- Such claims had gone stale several times while nobody re-read them.

**Containment.**
- `scripts/docker-test.sh` runs builds, tests, and the pre-commit stage in a memory- and
  CPU-capped container.
- The reason: on WSL2 a runaway build took the whole VM and the agent session down with it.

**The PostToolUse hook.** After every Edit or Write, Claude runs the crate check and gets the
last 20 lines back, which gives quick feedback inside a turn.

### 1.3 Lessons oqueue learned the hard way (from backlog rows and commit history)

| Lesson | Evidence in oqueue | What Fluxion should do |
|---|---|---|
| Plans overrun | M5 was planned at 20 tasks and grew to 38, then 85 rows. Other milestones ran 1.4x–5.2x over | Write the completion gate first, and treat a red gate as the real "what's left" |
| Review rounds can loop | Rounds were uncounted; `M5.50` took 5 rounds | Cap review at 3 rounds, and record every verdict |
| Deferrals leak into the current milestone | M4 opened 8, then 10, then 7 rows in boundary rounds | Decide each finding's disposition when it is filed, and send non-blocking ones to the next milestone |
| Two sessions shared one git index (`M1.48`) | The staged diff changed mid-review | Give **one git worktree per agent session** |
| An untracked `.git/hooks` file went stale (`M10.24`) | It ran only 12 of 17 gates | Track hooks in the repo and set `core.hooksPath` |
| Tool-name collisions happen silently (`M-1.36`) | The `goal` skill collided with the tools' own `/goal` | Keep skill names distinct from built-ins (`goal`, `review`, `init`, `plan`, `loop`…) |
| Prose bloat | `backlog.md` is **4,810 lines**, and there are many warning-heavy paragraphs | Archive finished milestones to their own files, keep rows short, and add a length gate |
| Unbounded builds crash the host | WSL2 VM exhaustion | Cap memory and CPU (container or `--max-old-space-size` / worker limits) |

---

## 2. Built-in goal loops (the "/goal slash command")

### 2.1 Claude Code `/goal` (docs: code.claude.com/docs/en/goal)

**Usage.**
- `/goal <condition>` sets a goal (up to 4,000 characters) and starts a turn right away.
- `/goal` with no argument shows status: the condition, elapsed time, turns, tokens, and the
  last reason.
- `/goal clear` removes the goal.
- One goal is allowed per session.

**How it works.**
- `/goal` is a session-scoped **prompt-based Stop hook**. After each turn, a small fast model
  (Haiku by default) reads the condition and the transcript.
- It returns one of three verdicts: *not yet met* (the reason is fed back as guidance), *met*,
  or *impossible*.
- **The evaluator does not run tools.** The working agent must print the evidence into the
  transcript, such as test output or a gate's exit code.

**Behaviour and settings.**
- A goal survives `--resume` and `--continue`, but the turn and token counters reset.
- It works headless: `claude -p "/goal …"`. Add `--output-format stream-json --verbose` to see
  progress while it runs.
- Pair it with **auto mode** so tool calls don't wait for approval.
- It stops by itself after several turns without tool use.
- Unrecoverable errors (auth, credits, context overflow, model unavailable) clear the goal.
  Transient ones retry or pause, and usage limits resume once the limit resets.
- While a subagent or background job runs, evaluation is skipped.
- Check-ins are controlled by `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`.

**What a good condition contains.** One measurable end state, the command that proves it, the
things that must not change, and a turn cap (for example, "or stop after 40 turns").

### 2.2 Codex `/goal` (Codex ≥ 0.128; cookbook "Using Goals in Codex")

**Usage and lifecycle.**
- Subcommands: `/goal <objective>`, `/goal pause`, `/goal resume`, `/goal clear`, and a status
  check.
- A goal is durable thread state. It persists across interruptions and continues automatically
  whenever the thread is idle.
- A goal is either active, paused, complete, or budget-limited.
- When the token budget runs out, Codex stops, summarizes, and names the next step.

**Completion.** The model completes the goal itself (task-complete signal), but only after
**auditing the objective against concrete evidence** such as changed files, commands run, and
test output.

**Writing a strong goal.** OpenAI's guidance names six parts:
1. the outcome;
2. the verification surface;
3. constraints (what must not regress);
4. boundaries (which files and tools are allowed);
5. an iteration policy;
6. a stop condition for when the goal is blocked.

### 2.3 Ralph loop / Wiggum technique

**Origin.** Geoffrey Huntley's idea is to rerun the same prompt in a loop:
`while true; cat PROMPT.md | agent`. Progress lives in files and git, not in the context
window.

**Plugin form.** Anthropic's `ralph-wiggum` plugin does this inside one session with a Stop
hook. The hook blocks the exit and feeds the prompt back until:
- the agent prints an exact completion phrase (`--completion-promise`), or
- `--max-iterations` is reached.

**When to use it.** It suits tasks with automatic verification. Avoid it for design judgement
or unclear success criteria.

**Relationship to `/goal`.** `/goal` is the productized successor:
- It uses a separate judge, not a self-declared phrase.
- It is resumable.
- It has budgets.

### 2.4 Custom Stop hooks (deterministic loop control)

Both tools let a hook script decide whether the loop continues:

| Tool | Where hooks are configured | How to force another turn |
|---|---|---|
| Claude Code | `.claude/settings.json` (Stop hook) | Return `decision: "block"` with a reason. Prompt-based hooks are also supported |
| Codex | `.codex/hooks.json` or `config.toml` | Return `{"decision":"block","reason":…}` or exit with code 2; Codex continues with the reason as the next prompt |

**Codex hook details.**
- Events: `SessionStart`, `PreToolUse`, `PostToolUse`, `PreCompact`, `UserPromptSubmit`,
  `SubagentStop`, `Stop`, and others.
- Hooks are trusted per content hash, so a changed hook must be re-approved.
- A `commandWindows` field allows a Windows-specific command.

**Why this matters.** A deterministic Stop hook can run the actual gate instead of trusting the
transcript. This closes the gap that `/goal`'s evaluator cannot run tools.

### 2.5 Anthropic "Effective harnesses for long-running agents"

**Two phases.**
- An *initializer* session creates:
  - a JSON feature list with `passes: false` per feature (JSON is harder for a model to corrupt
    than Markdown);
  - a progress log;
  - `init.sh`;
  - an initial commit.
- Each later *coding* session:
  1. reads git log and the progress file;
  2. starts the app;
  3. smoke-tests it;
  4. takes **one** feature;
  5. tests it end-to-end (browser automation);
  6. commits;
  7. updates the progress log.

**Failure modes it targets.** Declaring victory too early, one-shotting the whole app, leaving
no record for the next session, and skipping end-to-end checks. The article also forbids
editing or removing tests.

---

## 3. Portable skills, commands, and AGENTS.md (state of the art, Sept 2026)

| Concern | Claude Code | Codex CLI | Standard |
|---|---|---|---|
| Project instructions | `CLAUDE.md` (+ `@path` imports, up to 4 hops). Some reports say ≥ v2.1.277 reads `AGENTS.md` when no `CLAUDE.md` exists; **unverified**, so we don't rely on it | `AGENTS.md` at `~/.codex`, repo root, every directory down to cwd. `AGENTS.override.md` takes precedence. Combined cap `project_doc_max_bytes` = 32 KiB default | agents.md convention |
| Skills (project) | `.claude/skills/<name>/SKILL.md`; nested `.claude/skills` in subdirectories | `.agents/skills/` from cwd up to the repo root; symlinked folders are supported | agentskills.io |
| Skills (user) | `~/.claude/skills/` | `$HOME/.agents/skills/` (and `/etc/codex/skills`) | — |
| Slash commands | `.claude/commands/*.md`, now **merged with skills**. Both produce `/name`, with args via `$ARGUMENTS`/`$1`/named args | Custom prompts in `~/.codex/prompts` (`/prompts:name`) are **deprecated** and user-level only. Skills are invoked as `$skill-name` or through `/skills` | — |
| Skill extras | Frontmatter: `disable-model-invocation`, `allowed-tools`, `context: fork`, `agent`, `model`, `effort`, `paths`, `arguments`, `` !`cmd` `` context injection | `agents/openai.yaml` sets UI, invocation policy, and tool deps; `[[skills.config]]` disables a skill | Spec: `name` (≤64 chars, lowercase-hyphen, must match the dir), `description` (≤1024), optional `license`, `compatibility`, `metadata`, `allowed-tools`; body < 500 lines; `scripts/`, `references/`, `assets/` |
| Subagents | `.claude/agents/*.md` (tools and model restrictions) | Subagents exist (`SubagentStart`/`SubagentStop` hooks), and `codex exec` works headless | — |
| Hooks | `.claude/settings.json` | `.codex/hooks.json` / `config.toml`, trust by hash | — |
| Goal loop | `/goal` (Haiku judge, transcript-only) | `/goal` (self-audit on evidence, token budget, pause/resume) | — |

**Practical consequences.**
- Put the procedure in `.agents/skills/` once, where Codex finds it natively.
- For Claude, provide adapters: generated copies, symlinks, or pointer files in
  `.claude/skills/`. Symlinks on Windows need Developer Mode or admin rights, and git's
  `core.symlinks` setting, so **generated copies plus a drift check are the most robust
  choice**.
- Keep skill names distinct from built-in commands in both tools, including `goal`, `plan`,
  `review`, `init`, `loop`, `compact`, `status`, `model`, `skills`, and `agents`.

---

## 4. Lightweight spec-driven development: what to borrow

| Framework | Artifacts | What to borrow for Fluxion |
|---|---|---|
| **GitHub Spec Kit** | `memory/constitution.md` (project rules), `specs/NNN-feature/{spec,plan,tasks}.md`; commands specify → clarify → plan → tasks → analyze → implement | A *constitution* (our AGENTS.md non-negotiables), plus an explicit **clarify** step that lists open questions before planning, and an **analyze** consistency check across spec, plan, and tasks |
| **Kiro (AWS)** | `.kiro/specs/<feature>/requirements.md` (EARS: "WHEN … THE SYSTEM SHALL …"), `design.md`, `tasks.md`; `.kiro/steering/*.md` | **EARS-style acceptance criteria** (easy to turn into tests), and the three-file spec shape |
| **OpenSpec** | `openspec/specs/` (current truth), `openspec/changes/<id>/{proposal,design,tasks}.md` + spec deltas; archive merges the delta into the truth | **Delta specs plus archive**, so the living spec reflects what is built and finished changes don't pile up in active files (the answer to oqueue's 4.8k-line backlog). It did well in 2026 third-party benchmarks |
| **BMAD** | Persona agents (analyst, PM, architect, SM, dev, QA), PRD and architecture sharded into story files | Heavier than we need. Borrow only the idea of **story files carrying full context** for a fresh session |
| **oqueue SDD** | requirements (IDs) → roadmap (completion command) → milestone plan → backlog rows (one commit each) → ADRs | The **completion-condition-as-command** rule and the **trace chain**, which are the strongest parts |

A benchmark reported in 2026 found that spec frameworks give modest gains over no spec, and
the lightest one (OpenSpec) did best. Taken together with oqueue's experience, specs should be
**short, delta-based, and gate-backed**, not long documents.

---

## 5. What makes an autonomous goal loop reliable

These are drawn from oqueue, Anthropic's harness article, Ralph, and the `/goal` docs.

1. **The exit test is a command that exits 0**, written *before* the work and written red. An
   LLM judge (Claude `/goal`) or a self-audit (Codex) only *reads* the command's output. Every
   turn must print the gate result into the transcript.
2. **One task at a time, and one task per commit that leaves the tree green.** Commits are
   checkpoints and the unit that can be reverted.
3. **State lives in files, not in context.** The files are the roadmap, the backlog, a progress
   log, and git history. A fresh session must be able to rebuild state in under a minute.
4. **Deterministic gates run first; a reviewer spends attention only on semantics.** Hooks, the
   pre-commit stage, and CI call *the same* scripts, so one gate has one definition.
5. **Independent review that the loop can't skip**: the reviewer has no access to the author's
   reasoning, the verdict is bound to the diff hash, and a different model is used where
   practical.
6. **Anti-cheating guardrails:**
   - no deleting tests without a trailer;
   - no weakening thresholds;
   - no claiming a check passed without running it;
   - no silent scope widening.
7. **Explicit stop conditions** hand control back to the human: 3 failed attempts, a needed
   decision, a wrong spec, a destructive or outward action, or the top 3 tasks all blocked.
8. **Budgets:**
   - a turn or token cap on the goal;
   - a round cap on review;
   - a time budget on the pre-commit suite (gate latency divides throughput 1:1).
9. **Isolation:**
   - one worktree per concurrent session;
   - resource caps on builds and tests;
   - no push, publish, or network side effects unless asked.
10. **An outer loop checks drift.** A periodic review of the milestone as a whole turns findings
    into rows and hands off non-blocking ones, so the loop ends by disposition.

---

## 6. Proposed harness for Fluxion

### 6.1 Directory layout (works for Claude Code and Codex)

```
AGENTS.md                          layer-0 index (≤ ~250 lines, well under Codex's 32 KiB cap):
                                   mission line, "start here" links, standards table, skills table,
                                   non-negotiables (each naming its gate), commands to run, Never list
CLAUDE.md                          exactly:  @AGENTS.md   (adapter; nothing else)
packages/<pkg>/AGENTS.md           per-package context (core model, renderer, editor, layout, sdk…)

.agents/skills/                    CANONICAL procedures (Agent Skills spec; Codex reads natively)
  README.md                        layers, rules, table (generated)
  drive/SKILL.md                   the autonomous milestone loop (NOT named "goal")
  next-task/SKILL.md
  spec/SKILL.md                    + references/spec-template.md (EARS criteria)
  plan-milestone/SKILL.md          decompose current milestone into backlog rows; write gate first
  tdd/SKILL.md                     vitest red/green; Playwright for UI criteria
  verify/SKILL.md                  run the gate ladder, print evidence block
  code-review/SKILL.md             independent reviewer procedure + verdict schema
  milestone-review/SKILL.md        outer loop
  adr/SKILL.md
  ship/SKILL.md                    release checklist (never pushes/publishes unless asked)
  ui-check/SKILL.md                run app, screenshot/visual-diff an editor flow
.claude/skills/<name>/SKILL.md     GENERATED adapters (scripts/harness/sync-skills.mjs):
                                   same name/description + Claude-only frontmatter
                                   (e.g. context: fork for code-review, disable-model-invocation
                                   for drive/ship) + body "Read and follow .agents/skills/<name>/SKILL.md"
.claude/agents/reviewer.md         isolated reviewer (Read, Grep, Glob, Bash) — no author transcript
.claude/agents/milestone-reviewer.md
.claude/settings.json              PostToolUse(Edit|Write) → node scripts/gates/quick.mjs --changed
                                   (optional) Stop → node scripts/harness/stop-check.mjs
.codex/config.toml                 project settings (sandbox, approval policy for autonomous runs)
.codex/hooks.json                  same PostToolUse / Stop scripts (commandWindows where needed)
.githooks/pre-commit, commit-msg   tracked; call node scripts/gates/*.mjs; installed by
                                   `npm run setup` → git config core.hooksPath .githooks

docs/
  research/                        00-… 06-… (this corpus; upstream of product docs)
  requirements/requirements.md     FR-n / NFR-n with verification + status (agreed/provisional/UNDERIVED)
  architecture/                    package map + dependency rules; decisions/ADR-NNNN-*.md
  standards/                       sdd.md, testing.md, review.md, git.md, typescript.md,
                                   performance.md, a11y.md, file-format.md (each "Read when…")
  milestones/
    roadmap.md                     milestone table: id, kind, depends, COMPLETION COMMAND
    M<n>.md                        plan (hypothesis) — goal, decisions needed first, ≤20 tasks
  backlog/
    current.md                     ONLY the current milestone's rows (ID | task | acceptance | state | commit)
    archive/M<n>.md                closed milestones moved here (keeps current.md small)
  specs/<id>-<slug>/               OpenSpec-style change folder when a task needs more than a row:
    proposal.md  design.md  tasks.md  (EARS acceptance criteria)

.harness/                          loop state (tracked unless noted)
  progress.md                      append-only session log: date, session, tasks done, gate status,
                                   next step, blockers (≤ 10 lines per entry; rotated per milestone)
  state.json                       {milestone, currentTask, attempts, blockedReason, loopActive,
                                   reviewRound} — machine-readable, harder to corrupt than prose
  baselines/review-argued.txt      argued findings (reviewed at milestone boundary)
  baselines/mutation.json          mutation score floor per package
  reviews/milestone-*.json         milestone-review verdicts (tracked)
  review/<sha256>.json             per-commit verdicts (GITIGNORED, bound to staged diff)

scripts/
  gates/                           Node .mjs (cross-platform; Windows is a first-class dev host)
    quick.mjs                      tsc -b --noEmit + eslint + vitest related (changed files)
    precommit.mjs                  the full pre-commit ladder (single definition used by hook + CI)
    check-reviewed.mjs             staged-diff hash ↔ verdict
    check-commit-msg.mjs           "<TASK-ID>: …", ID exists in backlog/current.md
    check-tests-kept.mjs           deleted test requires "Removes-test:" trailer
    check-drift.mjs                thresholds only move in the strengthening direction
    check-layering.mjs             dependency-cruiser rules (core ⟂ DOM, renderer ⟂ editor, …)
    check-size.mjs                 file ≤ 500 lines, function ≤ 50, AGENTS.md/backlog length caps
    check-portability.mjs          no vendor syntax in AGENTS.md/SKILL.md; skill names unique &
                                   not colliding with built-ins; adapters in sync
    check-budget.mjs               pre-commit wall-time ceiling
    m<n>-complete.mjs              one completion gate per milestone (written first, red)
  harness/
    review.mjs                     context --task ID  → packet;  record --file v.json → verdict
    run-reviewer.mjs               spawns the OTHER tool headless on the packet (cross-model)
    sync-skills.mjs                .agents/skills → .claude/skills adapters (+ --check)
    build-index.mjs                regenerate tables in AGENTS.md between index markers
    stop-check.mjs                 deterministic Stop hook (see 6.4)
    worktree.mjs                   create/remove per-session worktrees
```

### 6.2 Commands (how a human or the loop invokes things)

| Intent | Claude Code | Codex | Skill (canonical) |
|---|---|---|---|
| Autonomous milestone | `/goal Follow the drive skill for M3 …` (see 6.3) | `/goal Follow $drive for M3 …` | `drive` |
| Spec a feature/milestone | `/spec <topic>` | `$spec <topic>` | `spec` |
| Plan/decompose milestone | `/plan-milestone M3` | `$plan-milestone M3` | `plan-milestone` |
| Pick next task | `/next-task` | `$next-task` | `next-task` |
| Implement a task | `/tdd F3.4` | `$tdd F3.4` | `tdd` |
| Verify | `/verify` | `$verify` | `verify` |
| Independent review | `/code-review F3.4` (forked subagent + cross-model) | `$code-review F3.4` | `code-review` |
| Milestone review | `/milestone-review` | `$milestone-review` | `milestone-review` |
| Decision record | `/adr` | `$adr` | `adr` |
| Release | `/ship` | `$ship` | `ship` |

The user wanted `/plan`, `/implement`, and `/review`. Those names were deliberately changed to
`plan-milestone`, `tdd`, and `code-review` so they don't collide with built-in commands
(Claude's plan mode and `/review`, Codex's `/review`). That is oqueue's `M-1.36` lesson.

### 6.3 The goal loop, concretely

The **built-in `/goal`** drives the loop in both tools, because both products already handle
the hard parts (turn continuation, resume, budgets). The repo supplies the *procedure* (the
`drive` skill) and the *exit test* (`m<n>-complete.mjs`).

Canonical goal text, saved as `.agents/skills/drive/references/goal-template.md` so humans can
paste it:

> Drive milestone M3 by following the `drive` skill, one backlog task per commit. The goal is
> met only when `node scripts/gates/m3-complete.mjs` exits 0 **and its output is printed in
> this conversation**. Each commit must first pass `node scripts/gates/precommit.mjs` and have
> a recorded review verdict. You must not:
> - edit or delete existing tests without a `Removes-test:` trailer;
> - weaken any threshold;
> - push or publish;
> - modify files under `docs/requirements/` without an ADR.
>
> At the end of every turn, print the gate summary and update `.harness/progress.md`. If a stop
> condition in the `drive` skill is hit, write the blocker to `.harness/state.json` and declare
> the goal impossible with the reason. Stop after 60 turns.

The `drive` skill (a procedure, ≤ 150 lines):

1. **Orient** (every session start and resume):
   - read `.harness/state.json`, the last 3 entries of `.harness/progress.md`,
     `git log -10 --oneline`, and `docs/milestones/roadmap.md`;
   - run `node scripts/gates/quick.mjs` to check the baseline is green.
2. **Precondition.** If the milestone's completion command is missing, the first task is to
   write it, red. If the backlog has no rows for this milestone, run `plan-milestone`.
3. **Loop** until `m<n>-complete.mjs` exits 0:
   1. `next-task`
   2. confirm the acceptance criteria are EARS-style and checkable
   3. `tdd`
   4. `verify` (the pre-commit ladder)
   5. `code-review` (another agent; record the verdict)
   6. fix or argue findings (max 3 rounds)
   7. commit `<ID>: …` with a `Co-Authored-By` trailer
   8. tick `backlog/current.md` with the commit short hash
   9. append to `progress.md`, update `state.json`
   10. rerun the completion command and print its summary
4. **Checkpoint.** Every ~8 commits, and before declaring done, run `milestone-review` with a
   fresh agent and decide each finding's disposition: reopen, hand off to the next milestone,
   or argue it.
5. **Stop conditions.** The loop stops and reports when:
   - a gate still fails after 3 fix attempts;
   - a decision is needed (the requirement is ambiguous, or standards conflict);
   - the spec is wrong;
   - the top 3 tasks are all blocked;
   - the completion gate is green but the milestone is obviously not done;
   - the next step is destructive or outward-facing.
6. **Report.** Say what was done, what was **not** done, and anything that invalidates the plan.

**Headless or overnight runs.**
- Claude:
  `claude -p "/goal $(cat .harness/goal.txt)" --permission-mode auto --output-format stream-json --verbose`,
  run inside a dedicated worktree.
- Codex: `/goal` inside a Codex session with a set token budget, or `codex exec` for single
  tasks.

### 6.4 Optional deterministic Stop hook

`/goal` in Claude trusts the transcript. To make the exit test itself decide, add
`scripts/harness/stop-check.mjs` to both `.claude/settings.json` and `.codex/hooks.json`. It
works like this:

- **Inactive:** when `.harness/state.json.loopActive` is false, it returns immediately and
  allows the stop. Normal interactive sessions are unaffected.
- **Active:** it runs `m<n>-complete.mjs --summary`.
  - If the command exits 0, it allows the stop and sets `loopActive=false`.
  - Otherwise it blocks, with a reason naming the first red leg and the next backlog row.
- **Stop conditions still win:** if `state.blockedReason` is set, or the goal's turn or
  iteration cap is reached, it allows the stop.

Use this hook *or* `/goal`, not both at once, to avoid double continuation. Start with plain
`/goal`, and add the hook only if the evaluator is seen accepting a pass that wasn't real.

### 6.5 Review: cross-model by default

- `review.mjs context --task ID` writes the packet: the backlog row, the staged diff (or the
  delta since the last round), the standards selected from paths, and the gates that passed.
  **It includes no author reasoning.**
- `run-reviewer.mjs` sends the packet to **the other vendor's CLI** in headless, read-only
  mode: `codex exec` when Claude authored, `claude -p --agent reviewer` when Codex authored. It
  expects verdict JSON (`verdict`, `findings[] {id, file, line, severity, failure_scenario}`,
  `diff_sha256`).
- oqueue's doc 21 lists a different reviewer model as a cheap way to decorrelate blind spots,
  and having two agent CLIs makes this free for us.
- `review.mjs record` validates the verdict and writes `.harness/review/<sha>.json`. The
  pre-commit gate `check-reviewed.mjs` requires it to exist.
- A risk-based bypass is **not** recommended at the start. Revisit it if the token cost hurts
  (oqueue's open question). One candidate rule: always review changes to `packages/core`, the
  file format, the public SDK, or security-relevant code.

### 6.6 Gate ladder for a TypeScript editor

| Tier | When | Contents (target time) |
|---|---|---|
| quick | PostToolUse hook / on demand | `tsc -b --noEmit` (incremental), eslint on changed files, `vitest related` (< 20 s) |
| pre-commit | every commit (the serial bottleneck) | typecheck, lint, vitest (unit + component), coverage floors, check-layering, check-size, check-drift, check-tests-kept, check-portability, check-reviewed, schema/format fixtures round-trip; **budget ≤ 90 s**, measured by check-budget |
| commit-msg | every commit | check-commit-msg, check-tests-kept trailer |
| milestone gate | every loop iteration | `m<n>-complete.mjs`: the milestone's legs (e.g. Playwright flows, visual snapshots of reference decks, perf numbers, file-format conformance) |
| CI | every push | the same `precommit.mjs --all` + Playwright e2e cross-browser + visual regression |
| scheduled | nightly | Stryker mutation (incremental, per package, floor in `baselines/mutation.json`), fuzz/property tests on the document schema and layout engine, bundle-size trend |

**Fluxion-specific notes:**
- An editor's acceptance criteria are often visual or interactive. Encode them as **Playwright
  tests with deterministic fixtures and screenshot baselines**, so the goal evaluator gets an
  exit code, not an opinion.
- Keep the document model, layout, and routing **pure** (no DOM or timers). This is oqueue's
  sans-I/O rule translated. It keeps vitest fast, and a slow unit test signals a layering leak.
- Changing a snapshot baseline is a threshold change. It needs a tracked reason line, the same
  way `check-drift` works.

### 6.7 Guardrails

- **Non-negotiables in `AGENTS.md`, each naming its gate:**
  1. one task = one commit = a green tree;
  2. never weaken a threshold or delete a test to pass;
  3. never claim a check ran without running it (no gate can enforce this);
  4. every commit is reviewed by another agent (hash-bound);
  5. core packages stay pure;
  6. a file-format or public-API change comes with an ADR and migration tests in the same
     commit;
  7. no new runtime dependency without a recorded reason.
- **Never list:**
  - push, publish, or deploy unless asked;
  - `--no-verify`;
  - force-push;
  - silent scope widening (out-of-scope work becomes a backlog row);
  - editing `docs/requirements/` without an ADR.
- **Isolation:**
  - one git worktree per concurrent agent session (`worktree.mjs`);
  - Node memory caps for test workers;
  - Playwright runs headless with a fixed viewport, fonts, and seeds.
- **Tool trust:** Codex hooks must be trusted per hash, and Claude hooks follow
  workspace-trust rules. Document the one-time trust step in `CONTRIBUTING.md`.
- **Anti-bloat:**
  - `AGENTS.md` stays at or under ~250 lines;
  - `backlog/current.md` holds only the open milestone, and closed milestones are archived;
  - skill bodies stay at or under 150 lines;
  - progress entries stay at or under 10 lines;
  - `check-size.mjs` enforces all of these. oqueue's backlog reached 4.8k lines, and its
    warning-heavy prose is the cautionary tale.
- **Self-checking docs:** generated index tables are checked with `build-index.mjs --check`.
  Any doc claim like "all gates exist" is checked by a script or deleted.

### 6.8 Bootstrapping order (milestone M-1 for Fluxion, as oqueue did)

1. `AGENTS.md`, the `CLAUDE.md` adapter, `docs/requirements`, and `docs/milestones/roadmap.md`
   with completion commands.
2. `.agents/skills/` (drive, next-task, spec, plan-milestone, tdd, verify, code-review,
   milestone-review, adr), plus `sync-skills.mjs` and the generated `.claude/skills`.
3. The gate scripts, `.githooks`, `npm run setup`, and CI running `precommit.mjs --all`.
4. `review.mjs`, `run-reviewer.mjs`, and `check-reviewed.mjs`, plus a negative test suite that
   proves each gate fails on a deliberately broken fixture (oqueue's `tests/gates/negative.sh`).
5. `.harness/state.json`, `progress.md`, and the goal template. Then do a dry run: `/goal` on a
   trivial M0 in each tool, and watch it stop correctly on both success and an impossible
   condition.

---

## 7. Open questions

- Should the reviewer always be cross-vendor, or same-vendor with a different model? Measure it
  on seeded bad diffs.
- Claude `/goal`'s evaluator versus a deterministic Stop hook: adopt the hook only if
  evaluator false positives are observed.
- Is Claude Code's native `AGENTS.md` reading reliable? If so, `CLAUDE.md` could be dropped.
  Until then keep `@AGENTS.md`, which works either way.
- What is the pre-commit time budget once Playwright component tests exist? It must be measured
  before it is fixed as a constant.

---

## Sources

oqueue (the user's repo; read locally at `E:\work\oqueue` and via GitHub):
- https://github.com/huyz0/oqueue — `AGENTS.md`, `CLAUDE.md`, `.agents/skills/*/SKILL.md`,
  `.claude/{commands,agents,settings.json}`, `.githooks/`, `.pre-commit-config.yaml`,
  `scripts/check-reviewed.sh`, `docs/researches/21-ai-development-loop.md`,
  `docs/internal/standards/{sdd,review,git}.md`, `docs/internal/product/{roadmap,backlog}.md`

Goal loops and harnesses:
- Claude Code `/goal`: https://code.claude.com/docs/en/goal
- Codex goals cookbook: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- Codex follow-a-goal use case: https://developers.openai.com/codex/use-cases/follow-goals/
- Codex `/goal` docs issue: https://github.com/openai/codex/issues/20536
- claude-goal (Codex-style /goal for Claude, pre-built-in): https://github.com/jthack/claude-goal
- Ralph Wiggum plugin: https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md
- History of Ralph: https://www.humanlayer.dev/blog/brief-history-of-ralph
- Anthropic, Effective harnesses for long-running agents: https://anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Codex hooks: https://developers.openai.com/codex/hooks (→ learn.chatgpt.com/docs/hooks)

Skills, commands, and AGENTS.md:
- Agent Skills spec: https://agentskills.io/specification and https://agentskills.io/home
- Claude Code skills: https://code.claude.com/docs/en/skills
- Codex skills: https://developers.openai.com/codex/skills (→ learn.chatgpt.com/docs/build-skills)
- Codex custom prompts (deprecated): https://developers.openai.com/codex/custom-prompts
- Codex AGENTS.md discovery: https://developers.openai.com/codex/guides/agents-md
- Claude Code and AGENTS.md (third-party reports, unverified): https://www.eesel.ai/blog/claude-code-agents-md ,
  https://dev.to/valyuai/claude-code-now-supports-agentsmd-natively-heres-how-it-actually-works-5nl

Spec-driven development:
- GitHub Spec Kit: https://github.com/github/spec-kit
- Kiro specs: https://kiro.dev/docs/specs/
- OpenSpec: https://github.com/Fission-AI/OpenSpec
- BMAD Method: https://github.com/bmad-code-org/BMAD-METHOD
- Comparisons: https://medium.com/@reenbit/bmad-vs-spec-kit-vs-openspec-choosing-your-spec-driven-ai-framework-in-2026-a6996b3ebb8d ,
  https://uvik.net/spec-driven-development-benchmark/ , https://specs.md/compare/overview
