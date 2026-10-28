// Phases of the cold setup check-budget --cold measures, and what to say when it fails (M18.154).
// The cold setup's total decides the gate; the phases only say where its time went, so a red
// cold-setup job names the slow or failing phase instead of one number (cp17 F1).

/** `PASS name (123ms)` / `FAIL name (123ms)` lines of the verify ladder, as precommit.mjs prints them. */
export function ladderSteps(output) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((l) => /^(PASS|FAIL) (\S+) \((\d+)ms\)/.exec(l))
    .filter(Boolean)
    .map((m) => ({ name: m[2], ms: Number(m[3]), ok: m[1] === 'PASS' }));
}

/**
 * Run `phases` ({ name, run }) in order, timing each with `now`, until one exits non-zero. A
 * phase's `run` returns a spawn result; its ladder steps, if any, are kept as `steps`.
 */
export function runPhases(phases, now = Date.now) {
  const done = [];
  for (const { name, run } of phases) {
    const t0 = now();
    const r = run();
    done.push({ name, ms: now() - t0, ok: r.status === 0, result: r, steps: ladderSteps(r.stdout) });
    if (r.status !== 0) break;
  }
  return done;
}

/**
 * Report lines for `phases` against `limitMs`, and the phase to blame: the first failed phase (its
 * failed ladder step when it has one) by status, else, over the limit, the slowest phase or ladder
 * step by time. The ladder runs steps after its build barrier in parallel, so a step's time is
 * the longest path it sits on, not a share of the total.
 */
export function coldReport(phases, limitMs) {
  const totalMs = phases.reduce((sum, p) => sum + p.ms, 0);
  const lines = phases.flatMap((p) => [
    `budget: cold phase ${p.name} ${p.ms} ms${p.ok ? '' : ' (failed)'}`,
    ...p.steps.map((s) => `budget: cold phase ${p.name}:${s.name} ${s.ms} ms${s.ok ? '' : ' (failed)'}`),
  ]);
  const failed = phases.find((p) => !p.ok);
  if (failed) {
    const step = failed.steps.find((s) => !s.ok);
    const name = step ? `${failed.name}:${step.name}` : failed.name;
    return { totalMs, lines, blame: `budget: cold setup failed by status in phase ${name} after ${(step ?? failed).ms} ms` };
  }
  if (totalMs <= limitMs) return { totalMs, lines, blame: null };
  const leaves = phases.flatMap((p) => (p.steps.length ? p.steps.map((s) => ({ name: `${p.name}:${s.name}`, ms: s.ms })) : [p]));
  const slowest = leaves.reduce((a, b) => (b.ms > a.ms ? b : a));
  return { totalMs, lines, blame: `budget: cold setup failed by time (${totalMs} ms > ${limitMs} ms); slowest phase ${slowest.name} ${slowest.ms} ms` };
}
