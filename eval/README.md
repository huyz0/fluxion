# Eval

`pnpm eval --recorded` replays `recordings/` through the real compiler, patcher and linter and writes `out/scorecard.{json,md}` (ADR-0039).

- `cases/<id>.json` — a prompt and what to expect. `recordings/<key>.json` — the replies, keyed by case, system prompt and model.
- **The current recordings are `scripted`**: written by `scripts/eval/author.ts`, not by a model. They test the harness and the pipeline, not model quality.
  `pnpm eval --author` rewrites them; a change to the cheat sheet or catalog changes every key, so run it after such a change.
- `--live` is not built. It would record real replies as `source: live` and needs a provider key; it is a roadmap Deferred row (owner M33), so the scorecard is a pipeline check until then.
