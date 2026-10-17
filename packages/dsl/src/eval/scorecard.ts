// The scorecard (ADR-0039): the metrics over a run's case results, as canonical JSON (sorted keys, numbers to one decimal, no clock) and markdown.
import type { CaseResult } from './run-case.js';

/**
 * The metrics of a run.
 *
 * @public
 */
export type Scorecard = {
  /** Cases run. */
  readonly cases: number;
  /** Percent of cases valid on the first attempt. */
  readonly oneShotValidPct: number;
  /** Percent valid after at most one repair round. */
  readonly afterRepairValidPct: number;
  /** Percent valid after at most two repair rounds. */
  readonly afterTwoRepairsValidPct: number;
  /** Repair rounds used, summed over the valid cases. */
  readonly repairRounds: number;
  /** Mean lint score of the valid cases. */
  readonly lintMean: number;
  /** Percent of cases that pass their expectations. */
  readonly expectPassPct: number;
  /** Mean JSON-over-FluxScript token ratio of the generate cases; null when none was counted. */
  readonly dslTokenRatio: number | null;
  /** Mean alt-text coverage over the cases that have such elements; reported only. */
  readonly altTextCoveragePct: number | null;
  /** Tokens read, summed. */
  readonly tokensIn: number;
  /** Tokens written, summed. */
  readonly tokensOut: number;
  /** The ids of the failing cases, sorted. */
  readonly failing: readonly string[];
};

const round = (n: number): number => Math.round(n * 10) / 10;
const pct = (part: number, whole: number): number => (whole === 0 ? 0 : round((part / whole) * 100));
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : round(sum(xs) / xs.length));
const present = (xs: readonly (number | null)[]): number[] => xs.filter((x): x is number => x !== null);

/**
 * The scorecard of `results`.
 *
 * @public
 */
export function scorecard(results: readonly CaseResult[]): Scorecard {
  const within = (n: number) => results.filter((r) => r.attempts !== null && r.attempts <= n).length;
  const valid = results.filter((r) => r.attempts !== null);
  return {
    cases: results.length,
    oneShotValidPct: pct(within(1), results.length),
    afterRepairValidPct: pct(within(2), results.length),
    afterTwoRepairsValidPct: pct(within(3), results.length),
    repairRounds: sum(valid.map((r) => (r.attempts ?? 1) - 1)),
    lintMean: mean(present(valid.map((r) => r.lint))) ?? 0,
    expectPassPct: pct(results.filter((r) => r.pass).length, results.length),
    dslTokenRatio: mean(present(results.map((r) => r.dslTokenRatio))),
    altTextCoveragePct: mean(present(results.map((r) => r.altCoveragePct))),
    tokensIn: sum(results.map((r) => r.tokensIn)),
    tokensOut: sum(results.map((r) => r.tokensOut)),
    failing: results
      .filter((r) => !r.pass)
      .map((r) => r.id)
      .sort(),
  };
}

const sorted = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sorted);
  if (typeof v !== 'object' || v === null) return v;
  return Object.fromEntries(
    Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => [k, sorted(x)]),
  );
};

/**
 * The scorecard as canonical JSON text: keys sorted, one trailing newline.
 *
 * @public
 */
export function scorecardJson(card: Scorecard, results: readonly CaseResult[]): string {
  const rows = [...results].sort((a, b) => (a.id < b.id ? -1 : 1));
  return `${JSON.stringify(sorted({ ...card, results: rows }), null, 2)}\n`;
}

/**
 * The scorecard as a markdown summary.
 *
 * @public
 */
export function scorecardMarkdown(card: Scorecard): string {
  const fmt = (v: number | null) => (v === null ? 'n/a' : String(v));
  const rows = [
    ['cases', card.cases],
    ['one-shot valid %', card.oneShotValidPct],
    ['valid after one repair %', card.afterRepairValidPct],
    ['valid after two repairs %', card.afterTwoRepairsValidPct],
    ['repair rounds', card.repairRounds],
    ['lint mean', card.lintMean],
    ['expectations met %', card.expectPassPct],
    ['JSON/FluxScript token ratio', card.dslTokenRatio],
    ['alt text coverage % (reported)', card.altTextCoveragePct],
    ['tokens in', card.tokensIn],
    ['tokens out', card.tokensOut],
  ] as const;
  const table = rows.map(([k, v]) => `| ${k} | ${fmt(v)} |`).join('\n');
  const failing = card.failing.length === 0 ? 'none' : card.failing.join(', ');
  return `# Eval scorecard\n\n| Metric | Value |\n|---|---|\n${table}\n\nFailing cases: ${failing}\n`;
}
