// The worst-case commit the staged ladder is timed on (NFR-DX-002, M8.20; M7 final F4). `check-budget.mjs --record` runs
// the staged ladder as if these paths were staged, not whatever is staged at that moment: a gate script no scope table
// names (every harness file), a workspace manifest (the packaging checks) and the Vitest config (the whole Vitest run,
// the browser project included). The ladder scoping of M7.32-M7.35 narrows ordinary commits; this is the commit it
// cannot narrow, so PRECOMMIT_BUDGET_MS keeps constraining the ladder.
export const WORST_CASE_STAGED = ['scripts/gates/lib.mjs', 'packages/core/package.json', 'vitest.config.ts'];
