// The recorded eval (ADR-0039, FR-AI-009): every case in eval/cases runs on its recording through the real compiler, patcher and linter, and the
// scorecard is written to eval/out. `pnpm eval --recorded` runs this file; EVAL_AUTHOR=1 first rewrites the scripted cases and recordings.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CaseResult, registerLintRules, runCase, scorecard, scorecardJson, scorecardMarkdown } from '@fluxion/dsl';
import { describe, expect, it } from 'vitest';
import { countTokens } from '../../packages/dsl/src/__fixtures__/token-count.js';
import { registries } from '../dsl/host-registries.js';
// @ts-expect-error the gate thresholds are plain JavaScript
import { t } from '../gates/thresholds.mjs';
import { authorAll } from './author.js';
import { CASES, loadCases, loadRecording, OUT, RECORDINGS, recordingKey, SCRIPTED_MODEL, systemPrompt, writeCase } from './common.js';

const system = systemPrompt();

async function runAll(): Promise<CaseResult[]> {
  const r = registries();
  registerLintRules(r.lintRules);
  const results: CaseResult[] = [];
  for (const c of loadCases()) {
    const recording = loadRecording(recordingKey(c, system, SCRIPTED_MODEL));
    results.push(await runCase(c, { registries: r, system, lintRegistry: r.lintRules, recording, countTokens }));
  }
  return results;
}

describe('the recorded eval (FR-AI-009, ADR-0039)', () => {
  it('FR-AI-009: EVAL_AUTHOR=1 rewrites the scripted cases and their recordings', () => {
    if (process.env['EVAL_AUTHOR'] !== '1') return;
    rmSync(CASES, { recursive: true, force: true });
    rmSync(RECORDINGS, { recursive: true, force: true });
    for (const a of authorAll()) writeCase(a.case, a.recording, system);
  });

  it('FR-AI-009: runs at least 30 cases and writes a scorecard that two runs reproduce byte for byte', async () => {
    const first = await runAll();
    expect(first.length).toBeGreaterThanOrEqual(30);
    const card = scorecard(first);
    const json = scorecardJson(card, first);
    const second = await runAll();
    expect(scorecardJson(scorecard(second), second)).toBe(json);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'scorecard.json'), json);
    writeFileSync(join(OUT, 'scorecard.md'), scorecardMarkdown(card));
    expect(card.failing, `failing cases: ${JSON.stringify(first.filter((r) => !r.pass))}`).toEqual([]);
  }, 120_000);

  it('NFR-AI-004: the mean lint score over the eval set is at least AI_LINT_SCORE_MIN', async () => {
    const results = await runAll();
    expect(scorecard(results).lintMean).toBeGreaterThanOrEqual(t('AI_LINT_SCORE_MIN'));
  }, 120_000);
});
