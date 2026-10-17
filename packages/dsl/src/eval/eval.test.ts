import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { LlmError } from '../generate/llm.js';
import { registerLintRules } from '../lint/lint.js';
import { type EvalCase, evalCaseSchema, type Recording, recordingSchema } from './case.js';
import { replayClient } from './replay.js';
import { type CaseDeps, runCase } from './run-case.js';
import { scorecard, scorecardJson, scorecardMarkdown } from './scorecard.js';

function deps(recording?: Recording): CaseDeps {
  const r = createCoreRegistries();
  r.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  registerLintRules(r.lintRules);
  return { registries: r, system: 'SYS', lintRegistry: r.lintRules, recording, countTokens: (t) => t.length };
}

const rec = (...replies: string[]): Recording => ({
  version: 1,
  source: 'scripted',
  model: 'm',
  requests: replies.map((text) => ({ chunks: [text.slice(0, 9), text.slice(9)], tokensIn: 3, tokensOut: 2 })),
});
const DOC = 'flux: 1\ntitle: T\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect, label: Alpha }\n';
const BROKEN = DOC.replace('shape: rect', 'shape: rectangle');
const REPAIR: EvalCase = { id: 'r', mode: 'repair', prompt: 'fix', inputs: { document: BROKEN }, expect: { screens: [1, 1], mustContain: ['Alpha'] } };
const EDIT: EvalCase = { id: 'e', mode: 'edit', prompt: 'add b', inputs: { document: DOC }, expect: { mustContain: ['Beta'] } };
const ADD = JSON.stringify({ flux: 1, ops: [{ op: 'add', screen: 'main', slug: 'b', node: { shape: 'rect', label: 'Beta' } }] });

describe('the eval harness (FR-AI-009, ADR-0039)', () => {
  it('FR-AI-009: a case file with an unknown key or a bad mode is rejected', () => {
    expect(evalCaseSchema.safeParse({ id: 'a', mode: 'generate', prompt: 'p', expect: {} }).success).toBe(true);
    expect(evalCaseSchema.safeParse({ id: 'a', mode: 'generate', prompt: 'p', expect: {}, extra: 1 }).success).toBe(false);
    expect(evalCaseSchema.safeParse({ id: 'a', mode: 'guess', prompt: 'p', expect: {} }).success).toBe(false);
    expect(recordingSchema.safeParse({ version: 1, source: 'live', model: 'm', requests: [] }).success).toBe(true);
    expect(recordingSchema.safeParse({ version: 2, source: 'live', model: 'm', requests: [] }).success).toBe(false);
  });

  it('FR-AI-009: a replay answers in order, reports usage, and fails with bad-response after the last reply', async () => {
    const replay = replayClient(rec('hello world'));
    const never = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined };
    const seen: string[] = [];
    for await (const c of replay.client.stream({ system: '', messages: [] }, never)) seen.push(c.type);
    expect(seen).toEqual(['text', 'text', 'usage', 'done']);
    expect(replay.used()).toBe(1);
    await expect(async () => {
      for await (const _ of replay.client.stream({ system: '', messages: [] }, never)) void _;
    }).rejects.toThrow(LlmError);
    expect(replay.exhausted()).toBe(true);
  });

  it('FR-AI-009: a missing recording fails the case as recording-missing', async () => {
    expect(await runCase(REPAIR, deps())).toMatchObject({ pass: false, attempts: null, failures: ['recording-missing'] });
  });

  it('FR-AI-009: a repair case that is fixed on the first reply is one-shot valid and meets its expectations', async () => {
    expect(await runCase(REPAIR, deps(rec(DOC)))).toMatchObject({ pass: true, attempts: 1, failures: [], tokensIn: 3, tokensOut: 2 });
  });

  it('FR-AI-009: a repair that needs a second reply takes two attempts; a third bad reply exhausts the recording and fails', async () => {
    expect(await runCase(REPAIR, deps(rec(BROKEN, DOC)))).toMatchObject({ pass: true, attempts: 2 });
    expect(await runCase(REPAIR, deps(rec(BROKEN, BROKEN, DOC)))).toMatchObject({ pass: true, attempts: 3 });
    expect(await runCase(REPAIR, deps(rec(BROKEN, BROKEN, BROKEN)))).toMatchObject({ pass: false, attempts: null });
    expect(await runCase(REPAIR, deps(rec(BROKEN)))).toMatchObject({ pass: false, failures: ['recording-exhausted'] });
  });

  it('FR-AI-009: an edit case applies the recorded patch, checks the expectation, and sends a rejected patch back', async () => {
    expect(await runCase(EDIT, deps(rec(ADD)))).toMatchObject({ pass: true, attempts: 1 });
    const bad = JSON.stringify({ flux: 1, ops: [{ op: 'remove', target: 'nothing-here' }] });
    expect(await runCase(EDIT, deps(rec(bad, ADD)))).toMatchObject({ pass: true, attempts: 2 });
    expect(await runCase(EDIT, deps(rec('not json', ADD)))).toMatchObject({ attempts: 2 });
    const wrong = await runCase({ ...EDIT, expect: { mustContain: ['Gamma'], kinds: ['image'], screens: [2, 3], minLint: 101 } }, deps(rec(ADD)));
    expect(wrong.pass).toBe(false);
    expect(wrong.failures).toEqual(['1 screens, expected 2 to 3', 'no image element', '"Gamma" does not appear', 'lint 100 below 101']);
  });

  it('FR-AI-009: a generate case counts the repair rounds of its screens and reports the JSON over FluxScript token ratio', async () => {
    const outline = JSON.stringify({ title: 'T', screens: [{ id: 'main', title: 'Main', intent: 'x' }] });
    const screen = '- id: main\n  nodes:\n    a: { shape: rect, label: Alpha }\n';
    const c: EvalCase = { id: 'g', mode: 'generate', prompt: 'p', expect: { screens: [1, 1], kinds: ['shape'] } };
    const clean = await runCase(c, deps(rec(outline, screen)));
    expect(clean).toMatchObject({ pass: true, attempts: 1 });
    expect(clean.dslTokenRatio).toBeGreaterThan(1);
    expect(await runCase(c, deps(rec(outline, screen.replace('rect', 'rectangle'), screen)))).toMatchObject({ pass: true, attempts: 2 });
  });

  it('NFR-AI-001: the scorecard counts one-shot, after-repair and after-two-repairs shares and lists the failing cases', () => {
    const r = (id: string, attempts: number | null, pass = attempts !== null) => ({
      id,
      mode: 'generate' as const,
      attempts,
      pass,
      failures: [],
      lint: attempts === null ? null : 90,
      altCoveragePct: null,
      dslTokenRatio: null,
      tokensIn: 1,
      tokensOut: 1,
    });
    const results = [r('a', 1), r('b', 1), r('c', 2), r('d', 3), r('e', null)];
    const card = scorecard(results);
    expect(card).toMatchObject({
      cases: 5,
      oneShotValidPct: 40,
      afterRepairValidPct: 60,
      afterTwoRepairsValidPct: 80,
      repairRounds: 3,
      lintMean: 90,
      expectPassPct: 80,
      failing: ['e'],
    });
    expect(card.dslTokenRatio).toBeNull();
    expect(scorecardMarkdown(card)).toContain('| one-shot valid % | 40 |');
    expect(scorecardMarkdown(card)).toContain('Failing cases: e');
  });

  it('NFR-AI-004: the scorecard lint mean averages the cases that were linted and skips those that never compiled', () => {
    const r = (id: string, lint: number | null) => ({
      id,
      mode: 'generate' as const,
      attempts: lint === null ? null : 1,
      pass: lint !== null,
      failures: [],
      lint,
      altCoveragePct: null,
      dslTokenRatio: null,
      tokensIn: 1,
      tokensOut: 1,
    });
    expect(scorecard([r('a', 80), r('b', 100), r('c', null)]).lintMean).toBe(90);
  });

  it('FR-AI-009: the scorecard JSON has sorted keys, rounds to one decimal and carries no timestamp', () => {
    const r = {
      id: 'a',
      mode: 'edit' as const,
      attempts: 1,
      pass: true,
      failures: [],
      lint: 91.234,
      altCoveragePct: 66.66,
      dslTokenRatio: null,
      tokensIn: 0,
      tokensOut: 0,
    };
    const text = scorecardJson(scorecard([r]), [r]);
    expect(text).toBe(scorecardJson(scorecard([r]), [r]));
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.indexOf('"afterRepairValidPct"')).toBeLessThan(text.indexOf('"cases"'));
    expect(text).toContain('"altTextCoveragePct": 66.7');
    expect(text).toContain('"lintMean": 91.2');
  });
});
