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
  PRECOMMIT_BUDGET_MS: { value: 120_000, weakens: 'up' },

  // coverage floors (NFR-MNT-004), percent
  COVERAGE_PURE_LINES: { value: 90, weakens: 'down' },
  COVERAGE_PURE_BRANCHES: { value: 85, weakens: 'down' },
  COVERAGE_RENDER_LINES: { value: 80, weakens: 'down' },
  COVERAGE_EDITOR_LINES: { value: 70, weakens: 'down' },
  MUTATION_PURE_SCORE: { value: 70, weakens: 'down' },

  // bundle & file size (NFR-SIZE), bytes gzip
  PLAYER_CORE_GZIP: { value: 150_000, weakens: 'up' },
  EDITOR_INITIAL_GZIP: { value: 600_000, weakens: 'up' },
  DOC20_FLUX_BYTES: { value: 150_000, weakens: 'up' },
  DOC20_FLUX_HTML_BYTES: { value: 450_000, weakens: 'up' },

  // performance (NFR-PERF)
  EDITOR_DRAG_MIN_FPS: { value: 55, weakens: 'down' },
  PRESENT_ANIM_MIN_FPS_DESKTOP: { value: 58, weakens: 'down' },
  PRESENT_ANIM_MIN_FPS_MOBILE: { value: 55, weakens: 'down' },
  LAYOUT_100_NODES_MS: { value: 200, weakens: 'up' },
  LAYOUT_500_NODES_MS: { value: 2_000, weakens: 'up' },
  ROUTE_200_ORTHO_MS: { value: 300, weakens: 'up' },
  UNDO_MAX_MS: { value: 16, weakens: 'up' },
  PERF_REGRESSION_TOLERANCE_PCT: { value: 15, weakens: 'up' },

  // visual
  PARITY_MAX_DIFF_PCT: { value: 0.1, weakens: 'up' },

  // AI quality (NFR-AI)
  AI_ONE_SHOT_VALID_PCT: { value: 90, weakens: 'down' },
  AI_AFTER_REPAIR_VALID_PCT: { value: 99, weakens: 'down' },
  AI_CATALOG_MAX_TOKENS: { value: 8_000, weakens: 'up' },
};

export const t = (key) => {
  const entry = THRESHOLDS[key];
  if (!entry) throw new Error(`Unknown threshold ${key}`);
  return entry.value;
};
