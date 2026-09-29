#!/usr/bin/env node
// Completion gate for M5 — Shapes, anchors & basic connectors (docs/milestones/M5.md).
// Written first and red (M5.1). Legs are behavioural: each runs the real tool, test or gate.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import * as checks from './milestone-checks.mjs';
import {
  backlogTextFor,
  checkBacklogDone,
  checkFinalReview,
  coverageGaps,
  loadMilestoneReviews,
  namedCases,
  propertyRuns,
  readmeGaps,
  titled,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const CLI_BIN = 'packages/cli/dist/bin.js';
const GALLERY = 'examples/shapes-gallery.flux.json';
const PACK = 'packs/basic';

/** Source text without comments, so a commented-out call never satisfies a leg. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const yamlCode = (text) => text.replace(/(^|\s)#.*$/gm, '$1');

// the CLI legs run the current sources, never a stale dist: build once, first
let buildResult;
const built = () => {
  buildResult ??= ok(pnpm('run', 'build'));
  return buildResult;
};
function cli(args) {
  const b = built();
  if (b !== true) return { status: 1, stdout: '', stderr: `build failed: ${b}` };
  if (!exists(CLI_BIN)) return { status: 1, stdout: '', stderr: `missing ${CLI_BIN} after the build` };
  return run(process.execPath, [repoPath(CLI_BIN), ...args]);
}

/** Test files (Vitest T0) of the workspaces under `roots`, tracked or new. */
function testFiles(roots) {
  const r = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...roots]);
  return r.stdout.split(/\r?\n/).filter((f) => /\/src\/.*\.test\.[cm]?[jt]sx?$/.test(f));
}

/** Shipped source files (no tests) of the workspaces under `roots`. */
function sources(roots) {
  const r = run('git', ['ls-files', '--', ...roots]);
  return r.stdout.split(/\r?\n/).filter((f) => /\/src\/.*\.[cm]?[jt]sx?$/.test(f) && !/\.(test|spec|bench|stories)\.[cm]?[jt]sx?$|\/__fixtures__\//.test(f));
}

const browser = (row, title, pkg = 'render') => [row, title, pkg, {}, 'browser'];

leg('check-trace --milestone M5 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M5'])));

// ── M4 final-review hand-offs (M5.md "Handed off from M4") ──────────────────────────────────────
leg("the loop reads the last push's CI before a task (M4 final F3)", () =>
  namedCases('tests/harness/last-ci.test.mjs', ['a red last run on main blocks the next task', 'a green or pending last run lets the task start']),
);
leg('changesets cover every package the milestone range changed (M4 final F1)', () => {
  if (typeof checks.changesetsCoverRange !== 'function') return 'milestone-checks.mjs exports no changesetsCoverRange (M5.3)';
  const unit = namedCases('tests/harness/milestone-checks.test.mjs', ['a package changed in the range without a changeset fails']);
  if (unit !== true) return unit;
  const first = run('git', ['rev-list', '--reverse', '--grep=^M5\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? checks.changesetsCoverRange(`${first}~1`) : 'no M5 commits yet';
});
leg('test:visual fails when it selects no test; ci.yml has no stale visual comment (M4 final F4)', () => {
  const script = json('package.json')?.scripts?.['test:visual'] ?? '';
  if (!script.includes('@visual')) return 'package.json test:visual does not select @visual';
  if (script.includes('--pass-with-no-tests')) return 'test:visual still passes with no tests (M5.3)';
  return !/no @visual specs exist/.test(readText('.github/workflows/ci.yml')) || 'ci.yml keeps the stale visual comment (M5.3)';
});
leg('renderDocumentToHtml reports what it rendered; the CLI counts from it (M4 final F2)', () => {
  const unit = titled([['M5.4', 'FR-CLI-001: renderDocumentToHtml reports the ids of the screens it rendered', 'render']]);
  if (unit !== true) return unit;
  const src = exists('packages/cli/src/render.ts') ? code(readText('packages/cli/src/render.ts')) : '';
  return !/fx-screen/.test(src) || 'packages/cli/src/render.ts still parses the rendered markup for its screen count';
});

// ── decisions and the expression interpreter (plan rows 2-3) ──────────────────────────────────
leg('ADR-0016 (shape outlines and the path-template expression language) is accepted', () => {
  const f = existsSync(repoPath('docs/architecture/decisions'))
    ? readdirSync(repoPath('docs/architecture/decisions')).find((n) => n.startsWith('ADR-0016-'))
    : undefined;
  if (!f) return 'missing docs/architecture/decisions/ADR-0016-*.md (M5.5)';
  return /^status:\s*accepted/m.test(readText(`docs/architecture/decisions/${f}`)) || `${f} is not accepted`;
});
leg('expression interpreter: diagnostics, 10 000 fuzzed templates, no eval or new Function anywhere', () => {
  const unit = titled([
    ['M5.6', 'FR-SHP-003: an unknown identifier or an exhausted step budget returns a diagnostic', 'core'],
    ['M5.6', 'FR-SHP-003: 10 000 fuzzed templates never throw and never run code', 'core'],
  ]);
  if (unit !== true) return unit;
  // any reference to eval (direct or indirect), Function, or a constructor reached through .constructor (M5.1 review F4)
  const hits = sources(['packages', 'packs', 'apps']).filter((f) => /\beval\b|\bFunction\s*\(|\.constructor\s*\(/.test(code(readText(f))));
  return hits.length === 0 || `eval, Function or .constructor( in ${hits.join(', ')}`;
});
leg('ShapeDef: a definition validates and its outline evaluates to a normalized cubic path', () =>
  titled([['M5.7', 'FR-SHP-003: a ShapeDef outline evaluates to a normalized cubic path', 'core']]),
);

// ── SDK and the basic pack (plan rows 3-6) ────────────────────────────────────────────────────
leg('packs/basic imports only @fluxion/sdk; definePack registers through the registry API', () => {
  const files = sources([PACK]);
  if (files.length === 0) return `${PACK} has no sources`;
  const foreign = files
    .flatMap((f) => [...code(readText(f)).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => [f, m[1]]))
    .filter(([, s]) => !s.startsWith('.') && s !== '@fluxion/sdk');
  if (foreign.length) return `packs/basic imports ${foreign.map(([f, s]) => `${s} (${f})`).join(', ')}`;
  const layering = ok(node('scripts/gates/check-layering.mjs'));
  if (layering !== true) return layering;
  return titled([['M5.8', 'FR-EXT-001: definePack registers its shape definitions through the registry API', 'sdk']]);
});
leg('the 21 basic shapes: parametric outlines, validated, inside their box', () =>
  titled([
    ['M5.10', 'FR-SHP-003: star points 5 to 8 gives 16 outline vertices', PACK],
    ['M5.11', 'FR-SHP-002: all 21 basic shapes validate and their outlines evaluate inside their box', PACK],
    ['M5.31', 'FR-SHP-003: a definition whose templates, expressions or handles do not parse or read unknown names is refused at validation', 'core'],
  ]),
);
leg('FR-SHP-005 per shape: projected points on the outline, interior and exterior hit samples', () =>
  titled([
    ['M5.12', 'FR-SHP-005: projected points lie on the outline of every basic shape', PACK],
    ['M5.12', 'FR-SHP-005: hit-testing classifies interior and exterior samples of every basic shape', PACK],
  ]),
);

// ── shape views (plan rows 7-9), T1 in Chromium ───────────────────────────────────────────────
leg('shape style, text layout and image views (T1)', () =>
  titled([
    browser('M5.13', 'FR-SHP-004: a theme change restyles token-bound shapes without re-rendering views'),
    browser('M5.13', 'FR-SHP-004: solid, gradient, pattern, image and none fills render with decorations'),
    ['M5.30', "FR-SHP-004: a definition's default style applies under the element's style, and open outlines are stroked without fill", 'render'],
    browser('M5.28', 'FR-SHP-004: stroke align inside and outside draw inside and outside the outline'),
    browser('M5.34', 'FR-SHP-004: dash, cap, join, opacity, shadow, blur and glow render from the resolved style'),
    browser('M5.14', 'FR-SHP-006: grow-shape height equals the measured text within 1 px'),
    browser('M5.14', 'FR-SHP-006: shrink keeps the bounds and the font at or above its minimum'),
    browser('M5.15', 'FR-SHP-012: mask with ellipse clips image'),
  ]),
);

// ── anchors and routers (plan rows 10-17) ─────────────────────────────────────────────────────
leg('anchors: floating projection and named anchors under resize and rotation', () =>
  titled([
    ['M5.16', 'FR-ANC-001: a floating anchor projects toward the other end onto the outline', 'routing'],
    ['M5.16', 'FR-ANC-002: an n-bound endpoint stays at top-middle under resize and rotation', 'routing'],
  ]),
);
leg('routers: pluggable by name; straight, curved, polyline and orthogonal', () =>
  titled([
    ['M5.17', 'FR-RTE-001: routeConnector routes with the router registered for the route type', 'routing'],
    browser('M5.35', 'FR-RTE-001: a registered test:zigzag router routes connectors of that type'),
    ['M5.18', 'FR-CON-002: curved routes leave their anchors along the anchor normals', 'routing'],
    ['M5.18', 'FR-CON-002: polyline routes pass through their waypoints', 'routing'],
    ['M5.19', 'FR-CON-002: orthogonal routes are axis-aligned and leave along the anchor normal', 'routing'],
  ]),
);
leg('markers, connector style and labels', () =>
  titled([
    ['M5.20', 'FR-CON-003: every marker scales with the stroke width and trims the path under it', 'render'],
    // drawn by the CLI, the host that bundles the pack (packs import only the SDK, ADR-0017)
    ['M5.36', 'FR-CON-003: every basic pack marker scales with the stroke width and trims the path under it', 'cli'],
    ['M5.21', 'FR-CON-005: rounded corners render with given radius', 'render'],
    browser('M5.22', 'FR-CON-006: a label at t 0.5 stays at the path midpoint when the endpoints move'),
  ]),
);
const ATTACHMENT = 'FR-CON-012: after random transforms endpoints lie on anchors';
leg('attachment invariant: after random transforms endpoints lie on anchors (1000 runs)', () => {
  // the plan's 1 000 runs, not fast-check's default 100 (M5 cp1 F4)
  const file = testFiles(['packages/routing']).find((p) => readText(p).includes(ATTACHMENT));
  if (file === undefined) return `no routing test titled "${ATTACHMENT}"`;
  const runs = propertyRuns(readText(file), ATTACHMENT);
  if (Number.isNaN(runs)) return `${file}: the property's numRuns is computed and cannot be read: use a number or a constant`;
  if (runs < 1000) return `${file}: the property runs ${runs || "the runner's default 200"} times (< 1 000)`;
  return titled([['M5.23', ATTACHMENT, 'routing']]);
});

// ── snapshots and the gallery (plan rows 18-19) ───────────────────────────────────────────────
/** The 21 basic shape ids of the plan (FR-SHP-002), the four route types and the markers of FR-CON-003. */
const BASIC_SHAPES = [
  'rect',
  'rounded-rect',
  'ellipse',
  'triangle',
  'diamond',
  'parallelogram',
  'trapezoid',
  'hexagon',
  'octagon',
  'star',
  'block-arrow',
  'callout',
  'cloud',
  'cylinder',
  'document',
  'note',
  'line',
  'polyline',
  'freehand',
  'text-box',
  'image-frame',
].map((s) => `basic:${s}`);
const ROUTES = ['straight', 'curved', 'polyline', 'orthogonal'];
// the document schema's built-in markers, plus the pack markers packs/basic registers under its namespace
// (the Marker type admits `<ns>:<name>`; M5.1 review r2 F1)
const MARKERS = [
  'arrow',
  'triangle',
  'diamond',
  'circle',
  'bar',
  'basic:open-arrow',
  'basic:crows-foot-one',
  'basic:crows-foot-many',
  'basic:crows-foot-zero-one',
  'basic:crows-foot-zero-many',
];

/** What a gallery document is missing: basic shape ids, route types, markers (M5.1 review F2). */
function galleryGaps(file) {
  if (!exists(file)) return [`missing ${file}`];
  const records = Object.values(json(file)?.records ?? {});
  const defs = new Set(records.filter((r) => r.kind === 'shape').map((r) => r.defId));
  const routes = new Set(records.filter((r) => r.kind === 'connector').map((r) => r.route?.type));
  const markers = new Set(records.filter((r) => r.kind === 'connector').flatMap((r) => [r.markers?.start, r.markers?.end, r.markers?.mid]));
  return [
    ...BASIC_SHAPES.filter((d) => !defs.has(d)),
    ...ROUTES.filter((r) => !routes.has(r)).map((r) => `route ${r}`),
    ...MARKERS.filter((m) => !markers.has(m)).map((m) => `marker ${m}`),
  ];
}
leg('SVG goldens: the shapes gallery (21 shapes, 4 routes, every marker) matches', () => {
  const gaps = galleryGaps('fixtures/docs/shapes-gallery.flux.json');
  if (gaps.length) return `the gallery fixture lacks ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? ', …' : ''}`;
  return titled([['M5.24', 'FR-SHP-002: the shapes gallery SVG goldens match', 'cli']]);
});
leg('visual spec render.shapes-gallery.spec.ts is @visual with baselines for the three desktop engines', () => {
  const spec = 'e2e/render.shapes-gallery.spec.ts';
  if (!exists(spec)) return `missing ${spec}`;
  const src = code(readText(spec));
  if (!/test\(\s*['"`][^'"`]*@visual/.test(src) || !/toHaveScreenshot\(/.test(src)) return `${spec} has no @visual test calling toHaveScreenshot`;
  const snaps = repoPath(`${spec}-snapshots`);
  const pngs = existsSync(snaps) ? readdirSync(snaps).filter((f) => f.endsWith('.png')) : [];
  const engines = ['chromium', 'firefox', 'webkit'].filter((e) => !pngs.some((p) => p.includes(`-${e}-`)));
  return engines.length === 0 || `no baseline for ${engines.join(', ')} in ${spec}-snapshots`;
});
leg(`${GALLERY} validates and renders through fluxion render`, () => {
  const gaps = galleryGaps(GALLERY);
  if (gaps.length) return `${GALLERY} lacks ${gaps.slice(0, 6).join(', ')}`;
  const v = cli(['validate', GALLERY]);
  if (v.status !== 0) return `validate: ${ok(v)}`;
  const dir = mkdtempSync(join(tmpdir(), 'm5-gallery-'));
  try {
    const out = join(dir, 'gallery.html');
    const r = cli(['render', GALLERY, '-o', out]);
    if (r.status !== 0 || !existsSync(out)) return `render: ${ok(r)}`;
    const html = readFileSync(out, 'utf8');
    // every basic shape is drawn by its definition, not by the placeholder
    const placeholders = (html.match(/class="fx-placeholder"/g) ?? []).length;
    const shapes = (html.match(/data-kind="shape"/g) ?? []).length;
    if (shapes < 21) return `the gallery draws ${shapes} shapes (< 21)`;
    return placeholders === 0 || `the gallery has ${placeholders} placeholder(s)`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
leg(
  'ci.yml renders the gallery with the built CLI',
  () =>
    /run:[^\n]*(fluxion|dist\/bin\.js)[^\n]*\brender\s+examples\/shapes-gallery\.flux\.json/.test(yamlCode(readText('.github/workflows/ci.yml'))) ||
    'ci.yml has no run step rendering the shapes gallery',
);
// what each README must name to describe M5 (M5 cp1 F4: a heading alone is not a description)
const README_NAMES = {
  'packs/basic/README.md': BASIC_SHAPES,
  // the routes, and the five anchor kinds of the schema's AnchorRef, backticked (M5.32 review F1)
  'packages/routing/README.md': [...ROUTES, '`auto`', '`floating`', '`named`', '`side`', '`point`'],
  'packages/sdk/README.md': ['definePack', 'registerShapeDef', 'evaluateOutline'],
};
leg('docs: packs/basic, routing and sdk READMEs describe M5', () => {
  const gaps = Object.entries(README_NAMES).flatMap(([f, names]) => {
    const r = exists(f) ? readmeGaps(readText(f), names) : 'missing';
    return r === true ? [] : [`${f}: ${r}`];
  });
  return gaps.length === 0 || gaps.join('; ');
});

// ── coverage floors (plan legs) ────────────────────────────────────────────────────────────────
function coverage(dir, lines, branches, min) {
  const out = mkdtempSync(join(tmpdir(), 'm5-cov-'));
  try {
    const r = pnpm(
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${out}`,
      '--reporter=json',
      `--outputFile=${join(out, 'report.json')}`,
      dir,
    );
    const report = join(out, 'report.json');
    if (!existsSync(report)) return `vitest wrote no report: ${ok(r)}`;
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `${dir}: ${numFailedTests} failed, ${numPassedTests} passed`;
    const summary = join(out, 'coverage-summary.json');
    if (!existsSync(summary)) return `no coverage summary: ${ok(r)}`;
    return coverageGaps(JSON.parse(readFileSync(summary, 'utf8')), dir, { lines, branches }, min);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
for (const [dir, min] of [
  ['packages/routing', 150],
  ['packages/geometry', 150],
  ['packages/core', 150],
  // the pack's definitions and their per-shape tests (M5 cp1 F4): held to the pure floors
  [PACK, 60],
])
  leg(`${dir} coverage at or above the pure-package floors`, () => coverage(dir, t('COVERAGE_PURE_LINES'), t('COVERAGE_PURE_BRANCHES'), min));
leg('packages/render coverage at or above the render floors', () =>
  coverage('packages/render', t('COVERAGE_RENDER_LINES'), t('COVERAGE_RENDER_BRANCHES'), 300),
);

// every planned verify step must PASS, through the shared leg (CI unset)
const VERIFY_STEPS = [
  'build',
  'harness-tests',
  'typecheck',
  'lint',
  'test',
  'knip',
  'publint',
  'attw',
  'size-limit',
  'layering',
  'licenses',
  'trace',
  'api',
  'budget',
  'kind-switch',
  'mode-policy',
];
leg('pnpm verify exits 0 with every planned step PASS', () => verifyLeg(VERIFY_STEPS));
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  return hits.length === 0 || `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
});

// the evidence includes the visual job, so the gallery screenshots are proven in CI (M5.1 review F1, r2 F2)
leg('CI green on ubuntu, windows and macos, visual job included, at or after the M5 final review range', () => {
  const unit = namedCases('tests/harness/ci-evidence.test.mjs', ['evidence without a green visual job fails']);
  return unit === true ? ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M5'])) : unit;
});
leg('every M5 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M5'), 'M5', loadMilestoneReviews('M5')));
leg('final milestone review covers M5', () => {
  const rev = json('.harness/reviews/milestone-M5-final.json');
  return rev ? checkFinalReview(rev, 'M5') : 'missing .harness/reviews/milestone-M5-final.json';
});
leg(
  'roadmap advanced past M5',
  () => !['M0', 'M1', 'M2', 'M3', 'M4', 'M5'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m5');
