// Property tests are reproducible (testing.md §4, rule 13): vitest.config.ts resolves FC_SEED (fixed
// in CI, replayable anywhere) and FC_RUNS (nightly: 10 000) and passes them to both projects through
// `test.env`; fast-check prints the seed on failure. Node sees them on process.env, the browser
// project on import.meta.env.
import fc from 'fast-check';

type Vars = Record<string, string | undefined>;
const proc = (globalThis as { process?: { env: Vars } }).process;
const vars: Vars = proc?.env ?? (import.meta as unknown as { env: Vars }).env;
const num = (name: string): number | undefined => {
  const raw = vars[name];
  return raw === undefined || raw === '' ? undefined : Number(raw);
};
const seed = num('FC_SEED');

fc.configureGlobal({ numRuns: num('FC_RUNS') ?? 200, ...(seed === undefined ? {} : { seed }) });
