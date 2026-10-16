// The `lint` operation: parse a document, run the lint rules of the host's registry and score it (FR-AI-005, FR-CLI-002).

import type { LintFinding, MeasureText } from '@fluxion/dsl';
import { lint, registerLintRules } from '@fluxion/dsl';
import { type Diagnostic, parseDocument } from '@fluxion/schema';
import type { CoreRegistries } from '@fluxion/sdk';
import { type OpResult, opFail, opOk } from './result.js';

/**
 * What a lint run reports.
 *
 * @public
 */
export type Linted = {
  /** 100 minus the weights of the findings, at least 0. */
  readonly score: number;
  /** Every finding, in rule order. */
  readonly findings: readonly LintFinding[];
};

/**
 * Wrap `text` greedily at `maxWidth` with `measurer` and report the size of the block: the lint rule asks for text size, the measurer
 * measures one run of lines.
 *
 * @public
 */
export function wrappedMeasure(measurer: {
  readonly measure: (
    text: string,
    font: { readonly family: string; readonly size: number; readonly weight?: number },
  ) => { readonly width: number; readonly height: number };
}): MeasureText {
  return (text, font, maxWidth) => {
    const lines: string[] = [];
    let current = '';
    for (const word of text.split(/\s+/).filter((w) => w !== '')) {
      const next = current === '' ? word : `${current} ${word}`;
      if (current !== '' && measurer.measure(next, font).width > maxWidth) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current !== '') lines.push(current);
    const sizes = lines.map((l) => measurer.measure(l, font));
    const line = measurer.measure('Ag', font).height;
    return { w: Math.max(0, ...sizes.map((s) => s.width)), h: Math.max(1, lines.length) * line };
  };
}

const belowMin = (score: number, min: number): Diagnostic => ({
  code: 'FLX_LINT_SCORE_BELOW_MIN',
  severity: 'error',
  path: '',
  message: `the lint score ${score} is below the minimum ${min}`,
  hint: 'Fix the findings, or lower --min-score.',
});

/**
 * Lint the document in `text`. With `minScore`, a lower score fails the operation: the findings and a `FLX_LINT_SCORE_BELOW_MIN` are its diagnostics.
 *
 * @public
 */
export function lintDocument(
  text: string,
  registries: CoreRegistries,
  options: { readonly minScore?: number; readonly measure?: MeasureText } = {},
): OpResult<Linted> {
  const parsed = parseDocument(text);
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  registerLintRules(registries.lintRules);
  const report = lint(parsed.value.document, registries.lintRules, options.measure ? { measureText: options.measure } : {});
  if (options.minScore !== undefined && report.score < options.minScore)
    return opFail([...parsed.value.diagnostics, ...report.findings, belowMin(report.score, options.minScore)]);
  return opOk({ score: report.score, findings: report.findings }, parsed.value.diagnostics);
}
