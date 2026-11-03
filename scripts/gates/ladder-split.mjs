// Splitting the full ladder across CI jobs (ADR-0214, M18.256): `precommit.mjs --all --skip a,b` runs every leg but
// those, `--all --only a,b` runs those plus the ordered prefix up to the build barrier (typecheck, build: the later legs
// read dist/). Together the jobs run the whole ladder; each leg that a job leaves to another prints a SKIP line naming why.

/** The flag's comma-separated list from `argv`, undefined when the flag is absent. @param {string[]} argv @param {string} flag */
export function listFlag(argv, flag) {
  const at = argv.indexOf(flag);
  return at < 0 ? undefined : (argv[at + 1] ?? '').split(',').filter(Boolean);
}

/**
 * Why the split leaves each step to another job, by step name (absent: the step runs here), or an error.
 * @param {string[]} names the applicable steps in ladder order
 * @param {{ skip?: string[], only?: string[], mode: string, barrier: string, known: string[] }} o
 * @returns {{ error: string } | { off: Map<string, string> }}
 */
export function splitLadder(names, { skip, only, mode, barrier, known }) {
  if (!skip && !only) return { off: new Map() };
  if (mode !== 'all') return { error: '--skip and --only split the full ladder across CI jobs; they need --all' };
  if (skip && only) return { error: 'give --skip or --only, not both' };
  const listed = skip ?? only ?? [];
  const unknown = listed.filter((n) => !known.includes(n));
  if (!listed.length || unknown.length) return { error: `--skip/--only name no leg or an unknown one: ${unknown.join(', ') || '(empty list)'}` };
  const barrierAt = names.indexOf(barrier);
  const off = new Map();
  names.forEach((name, i) => {
    if (skip?.includes(name)) off.set(name, '--skip: run by another CI job');
    else if (only && i > barrierAt && !only.includes(name)) off.set(name, '--only: run by another CI job');
  });
  return { off };
}
