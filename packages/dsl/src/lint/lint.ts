// The linter (06-ai-authoring.md §7, FR-AI-005): run the rules of the `lintRules` registry over a document and score the result.
import type { DocumentFile } from '@fluxion/schema';
import { LAYOUT_RULES } from './rules-layout.js';
import { STYLE_RULES } from './rules-style.js';
import type { LintContext, LintRegistry, LintReport, LintRule } from './types.js';

/**
 * The core lint rules, in report order: OVERLAP, OFFSCREEN, TEXT_OVERFLOW, DENSITY, ORPHAN_CONNECTOR, CONTRAST, STYLE_LITERAL, STYLE_INCONSISTENT.
 *
 * @public
 */
export const CORE_LINT_RULES: readonly LintRule[] = [...LAYOUT_RULES, ...STYLE_RULES];

const isRule = (v: unknown): v is LintRule =>
  typeof v === 'object' && v !== null && typeof (v as LintRule).check === 'function' && typeof (v as LintRule).weight === 'number';

/**
 * Register the core rules in a host's `lintRules` registry, as source `core`.
 *
 * @public
 */
export function registerLintRules(registry: LintRegistry): void {
  for (const rule of CORE_LINT_RULES) registry.register(`core:${rule.id}`, rule, 'core');
}

/**
 * Lint `doc` with the rules of `registry` (a plugin's rules run after the core ones; the registry's order). The score is 100 minus the sum
 * over the findings of their rule's weight, never below 0.
 *
 * @public
 */
export function lint(doc: DocumentFile, registry: LintRegistry, ctx: LintContext = {}): LintReport {
  const rules = registry
    .list()
    .map(([, rule]) => rule)
    .filter(isRule);
  const findings = rules.flatMap((rule) => rule.check(doc, ctx));
  const byCode = new Map(rules.map((r) => [r.code, r.weight]));
  const penalty = findings.reduce((sum, f) => sum + (byCode.get(f.code) ?? 0), 0);
  return { score: Math.max(0, 100 - penalty), findings };
}
