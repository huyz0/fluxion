#!/usr/bin/env node
// The readings the nightly's @perf specs annotate (a `<what> fps` annotation: perf.big-screen, perf.route-drag-200), printed to the job's log on every run (M18.131). The
// list and github reporters do not print annotations, and the report JSON is uploaded only when the job fails, so without this a pass says nothing of its margin over a floor.
// Never fails the job: a missing or unreadable report is said and skipped.
//   node scripts/ci/perf-readings.mjs <report.json>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The fps annotations of one test: those it pushed while running are on its results and, for the last attempt, on the test too. */
const fpsNotes = (test) =>
  [...(test.annotations ?? []), ...(test.results ?? []).flatMap((r) => r.annotations ?? [])].filter(
    (n) => typeof n?.type === 'string' && n.type.endsWith(' fps'),
  );

/** The specs of a suite and every suite in it, each with the file it is in. */
function* specsOf(suite, file) {
  const here = suite.file ?? file;
  for (const spec of suite.specs ?? []) yield { spec, file: here };
  for (const child of suite.suites ?? []) yield* specsOf(child, here);
}

/** The lines of one spec's tests. */
const specLines = ({ spec, file }) =>
  (spec.tests ?? []).flatMap((test) =>
    fpsNotes(test).map((note) => `${file ?? '?'} › ${spec.title} [${test.projectName ?? '?'}]: ${note.type} ${note.description ?? '?'}`),
  );

/** One line per annotation whose type ends in ` fps`, in report order, each once: `<file> › <title> [<project>]: <type> <value>`. */
export function readings(report) {
  const all = (report?.suites ?? []).flatMap((top) => [...specsOf(top, undefined)].flatMap(specLines));
  return [...new Set(all)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? 'test-results/e2e.json';
  try {
    const lines = readings(JSON.parse(readFileSync(path, 'utf8')));
    for (const line of lines) console.log(`perf-readings: ${line}`);
    if (lines.length === 0) console.log(`perf-readings: no fps annotation in ${path}`);
  } catch (e) {
    console.log(`perf-readings: could not read ${path}: ${e?.message ?? e}`);
  }
}
