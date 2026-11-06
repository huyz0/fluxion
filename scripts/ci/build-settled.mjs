#!/usr/bin/env node
// `pnpm run build` for CI steps outside the pre-commit ladder (cli-mcp), with the ladder's settle (M18.281): once turbo has
// printed every task successful, the build gets 60 s to exit, then its process tree is ended, its process table is saved under
// .harness/tmp/stuck-build/ and the step goes on with a ::warning::. A failed build, or one that never prints the summary, keeps
// its exit status.
import { repoPath, runAsync, TURBO_ALL_SUCCESSFUL, withProcessOutput } from '../gates/lib.mjs';

const ms = Number(process.env.FLUXION_BUILD_SETTLE_MS ?? 60_000);
const res = await withProcessOutput(
  (stream, d) => (stream === 'stdout' ? process.stdout : process.stderr).write(d),
  () => runAsync('pnpm', ['run', 'build'], { settle: { done: TURBO_ALL_SUCCESSFUL, ms, reportDir: repoPath('.harness/tmp/stuck-build'), label: 'build' } }),
);
process.exit(res.status);
