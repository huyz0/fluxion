// Every numeric gate threshold lives here. check-drift.mjs (M0) refuses any change that moves a
// value in its WEAKENING direction unless the commit carries `Threshold-change: <reason>` and an
// ADR reference. `weakens` names the direction that weakens the gate.
//
// Values mirror docs/requirements/30-non-functional.md. Change both together.

export const THRESHOLDS = {
  // harness hygiene
  AGENTS_MD_MAX_LINES: { value: 250, weakens: 'up' },
  SKILL_MAX_LINES: { value: 150, weakens: 'up' },
  PACKAGE_AGENTS_MD_MAX_LINES: { value: 60, weakens: 'up' },
  BACKLOG_MAX_LINES: { value: 400, weakens: 'up' },
  PROGRESS_ENTRY_MAX_LINES: { value: 10, weakens: 'up' },
  REVIEW_ROUND_CAP: { value: 3, weakens: 'up' },

  // code structure (NFR-MNT-003)
  FILE_MAX_LINES: { value: 400, weakens: 'up' },
  FUNCTION_MAX_LINES: { value: 60, weakens: 'up' },
  COMPLEXITY_MAX: { value: 12, weakens: 'up' },

  // gate latency (NFR-DX-002), milliseconds
  QUICK_GATE_BUDGET_MS: { value: 30_000, weakens: 'up' },
  PRECOMMIT_BUDGET_MS: { value: 360_000, weakens: 'up' }, // ADR-0158 (was 120 s)
  COLD_SETUP_MAX_MS: { value: 600_000, weakens: 'up' }, // fresh clone: pnpm i + pnpm run setup + pnpm verify (NFR-DX-001)

  // coverage floors (NFR-MNT-004), percent
  COVERAGE_PURE_LINES: { value: 90, weakens: 'down' },
  COVERAGE_PURE_BRANCHES: { value: 85, weakens: 'down' },
  COVERAGE_RENDER_LINES: { value: 80, weakens: 'down' },
  COVERAGE_RENDER_BRANCHES: { value: 75, weakens: 'down' }, // testing.md §6 (render, player)
  COVERAGE_EDITOR_LINES: { value: 70, weakens: 'down' },
  COVERAGE_EDITOR_BRANCHES: { value: 65, weakens: 'down' }, // testing.md §6

  // mutation score (NFR-MNT-005 minimum 70 %), percent: core's target after triaging the M3 trial's
  // survivors (ADR-0146, M4.8); a package's recorded floor lives in .harness/baselines/mutation.json
  MUTATION_CORE_TARGET: { value: 90, weakens: 'down' },
  MUTATION_PURE_SCORE: { value: 70, weakens: 'down' },

  // bundle & file size (NFR-SIZE), bytes gzip
  PLAYER_CORE_GZIP: { value: 150_000, weakens: 'up' },
  EDITOR_INITIAL_GZIP: { value: 600_000, weakens: 'up' },
  DOC20_FLUX_BYTES: { value: 150_000, weakens: 'up' },
  DOC20_FLUX_HTML_BYTES: { value: 450_000, weakens: 'up' },

  // performance (NFR-PERF)
  EDITOR_DRAG_MIN_FPS: { value: 55, weakens: 'down' },
  HIT_TEST_2000_MAX_MS: { value: 1, weakens: 'up' }, // M6: point hit-test among 2000 elements (FR-EDT-004)
  NAVIGATOR_OPEN_50_MAX_MS: { value: 200, weakens: 'up' }, // M8: the screens navigator opens with 50 screens (FR-SCR-002)
  LIBRARY_SEARCH_10K_MAX_MS: { value: 100, weakens: 'up' }, // M8: keyword search over 10k library entries (FR-LIB-001)
  OPEN_50_SCREENS_MS_DESKTOP: { value: 1500, weakens: 'up' }, // M11: open a 50-screen document and show the first screen (NFR-PERF-003)
  OPEN_50_SCREENS_MS_MOBILE: { value: 3000, weakens: 'up' }, // M11: the same on the reference mobile, 4x CPU throttle (NFR-PERF-003)
  EDITOR_TTI_MS: { value: 2500, weakens: 'up' }, // M11: editor time to interactive on the reference desktop (NFR-SIZE-002)
  PRESENT_ANIM_MIN_FPS_DESKTOP: { value: 58, weakens: 'down' },
  PRESENT_ANIM_MIN_FPS_MOBILE: { value: 55, weakens: 'down' },
  LAYOUT_100_NODES_MS: { value: 200, weakens: 'up' },
  LAYOUT_500_NODES_MS: { value: 2_000, weakens: 'up' },
  ROUTE_200_ORTHO_MS: { value: 300, weakens: 'up' },
  UNDO_MAX_MS: { value: 16, weakens: 'up' },
  PERF_REGRESSION_TOLERANCE_PCT: { value: 15, weakens: 'up' },

  // visual
  PARITY_MAX_DIFF_PCT: { value: 0.1, weakens: 'up' },
  // a parity pixel differs when a channel is off by more than this (of 255)...
  PARITY_CHANNEL_DELTA: { value: 8, weakens: 'up' },
  // ...unless it is anti-aliasing: on an edge (a neighbour this much apart) in both images
  PARITY_EDGE_DELTA: { value: 64, weakens: 'down' },

  // AI quality (NFR-AI)
  AI_ONE_SHOT_VALID_PCT: { value: 90, weakens: 'down' },
  AI_AFTER_REPAIR_VALID_PCT: { value: 99, weakens: 'down' },
  AI_CATALOG_MAX_TOKENS: { value: 8_000, weakens: 'up' },
};

// Licence policy (NFR-LIC-002, tech-stack.md §3), read by check-licenses.mjs. check-drift treats a
// new allowed licence, a wider pack exception, or a dropped deny entry as weakening.
export const LICENSES = {
  // shipped (production) dependencies of every workspace
  allow: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'MPL-2.0'],
  // EPL / LGPL only as optional, separately loaded, unmodified packs (tech-stack.md §3 rule 2)
  packExceptions: {
    'packs/layouts-elk': ['EPL-2.0'],
    'packs/routing-libavoid': ['LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later'],
  },
  // never, not even as a dev tool: strong copyleft and source-available licences (SPDX id prefixes)
  denyPrefixes: ['GPL-', 'AGPL-', 'SSPL-', 'BUSL-'],
  // watermark / domain-key / licence-key libraries (rule 3), whatever their licence field says
  denyPackages: ['tldraw', '@tldraw/tldraw', 'bpmn-js', 'gojs', '@joint/plus', 'yfiles'],
};

// Font-file licence policy (FR-THM-008, ADR-0022), read by check-licenses.mjs beside the code one above: a font is data, and the content-asset
// licences of tech-stack.md §3 rule 1 apply. check-drift treats a new allowed licence as weakening.
export const FONT_LICENSES = {
  allow: ['OFL-1.1', 'Apache-2.0'],
};

export const t = (key) => {
  const entry = THRESHOLDS[key];
  if (!entry) throw new Error(`Unknown threshold ${key}`);
  return entry.value;
};
