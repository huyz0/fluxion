// Shared pieces of the editor milestones' completion gates (M7 on; M6 final F4): the Playwright
// groups a gate runs once each and judges per leg, and the performance legs every editor gate reruns
// (the hit-test bench and the 500-element drag and resize), so a later milestone cannot slow them
// unseen (M3 final F1, again in M6).
import { existsSync, readFileSync } from 'node:fs';
import { runInImage } from '../e2e/image.mjs';
import { exists, readText, repoPath } from './lib.mjs';
import { benchUnder, checkPlaywrightReport, checkPlaywrightTitles, dockerAvailable, playwrightReport } from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

export const DESKTOP = ['chromium', 'firefox', 'webkit'];
export const MOBILE = ['mobile-chrome', 'mobile-safari'];
export const PERF = ['perf'];

/** Source text without comments, so a commented-out call never satisfies a leg. */
export const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

/**
 * E2E legs over `groups` ({name: {projects, specs, workers?}}): every group's specs run once per gate
 * (in ci.yml's pinned image through Docker when available, else the local browsers;
 * FLUXION_E2E=local forces local), then each leg judges its own specs and titles.
 */
export function createE2e(groups) {
  const reports = new Map();
  const runner = () =>
    process.env.FLUXION_E2E !== 'local' && dockerAvailable() ? (args, env) => runInImage(args, { report: env.PLAYWRIGHT_JSON_OUTPUT_NAME }) : undefined;
  const groupOf = (projects) => Object.keys(groups).find((g) => groups[g].projects === projects) ?? 'desktop';
  const report = (projects) => {
    const group = groupOf(projects);
    if (!reports.has(group)) {
      const { specs, projects: ps, workers } = groups[group];
      const r = runner();
      reports.set(group, playwrightReport(specs.filter(exists), ps, { ...(r ? { runner: r } : {}), ...(workers === undefined ? {} : { workers }) }));
    }
    return reports.get(group);
  };
  /** Whether `specs` pass on `projects` in their group's one run; a missing spec fails first. */
  const e2e = (specs, projects) => {
    const missing = specs.filter((s) => !exists(s));
    if (missing.length) return `missing ${missing.join(', ')}`;
    const r = report(projects);
    return typeof r === 'string' ? r : checkPlaywrightReport(r, specs, projects);
  };
  /** A spec that passes, with a passing test under each of `titles` on every project (M6 cp1 F4). */
  const titledSpec = (spec, projects, titles) => {
    const passed = e2e([spec], projects);
    return passed === true ? checkPlaywrightTitles(report(projects), spec, titles, projects) : passed;
  };
  /** A titled spec that reads its bound `key` from thresholds.mjs (a literal would drift from it). */
  const thresholdSpec = (spec, key, projects, titles) => {
    if (!exists(spec)) return `missing ${spec}`;
    if (!code(readText(spec)).includes(key)) return `${spec} does not read ${key} from thresholds.mjs`;
    return titledSpec(spec, projects, titles);
  };
  return { e2e, titledSpec, thresholdSpec };
}

/** The perf group every editor gate adds to its groups: the benchmark alone, one worker. */
export const PERF_GROUP = { projects: PERF, specs: ['e2e/perf.drag-500.spec.ts'], workers: 1 };

/** The titles the drag benchmark must pass: a drag and a resize among 500 (NFR-PERF-001 "drag/resize"). */
export const PERF_TITLES = [
  'NFR-PERF-001: dragging one element among 500 keeps at least EDITOR_DRAG_MIN_FPS over the measured frames',
  'NFR-PERF-001: resizing one element among 500 keeps at least EDITOR_DRAG_MIN_FPS over the measured frames',
];

/**
 * Register the performance legs every editor milestone gate reruns: the hit-test-2000 bench under
 * HIT_TEST_2000_MAX_MS, and the 500-element drag and resize at EDITOR_DRAG_MIN_FPS or better.
 */
export function editorPerfLegs(leg, { thresholdSpec }) {
  leg(`hit-test-2000 bench within HIT_TEST_2000_MAX_MS (${t('HIT_TEST_2000_MAX_MS')} ms)`, () =>
    benchUnder('packages/editor/bench/hit-test-2000.bench.ts', 'hit-test-2000', t('HIT_TEST_2000_MAX_MS')),
  );
  leg(`dragging and resizing 1 of 500 elements stays at or above EDITOR_DRAG_MIN_FPS (${t('EDITOR_DRAG_MIN_FPS')})`, () => {
    const doc = json('fixtures/docs/perf-500.flux.json');
    const elements = Object.values(doc?.records ?? {}).filter((r) => r.type === 'element').length;
    if (elements < 500) return `fixtures/docs/perf-500.flux.json has ${elements} elements (< 500)`;
    return thresholdSpec('e2e/perf.drag-500.spec.ts', 'EDITOR_DRAG_MIN_FPS', PERF, PERF_TITLES);
  });
}
