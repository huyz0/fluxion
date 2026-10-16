// NFR-AI-003, ADR-0037: over the whole examples/dsl corpus FluxScript costs at most a third of the canonical JSON it compiles to. The ratio is
// the sum of the canonical-JSON tokens over the sum of the FluxScript tokens (not a mean of per-file ratios), counted with the pinned tokenizer.
// It runs in this runner, not in packages/dsl, because compiling the corpus needs the first-party packs (see examples.config.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@fluxion/dsl';
import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { countTokens } from '../../packages/dsl/src/__fixtures__/token-count.js';
import { t } from '../gates/thresholds.mjs';
import { registries } from './host-registries.js';

const DIR = join(import.meta.dirname, '..', '..', 'examples', 'dsl');
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.flux.yaml'))
  .sort();

describe('the token cost of FluxScript against canonical JSON (NFR-AI-003)', () => {
  const rows = FILES.map((file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    const { doc } = compile(source, { registries: registries() });
    return { file, dsl: countTokens(source), json: countTokens(serializeDocument(doc as DocumentFile)) };
  });

  it('NFR-AI-003: the corpus is not empty', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('NFR-AI-003: canonical JSON costs at least AI_DSL_TOKEN_RATIO_MIN times the FluxScript, over the corpus', () => {
    const dsl = rows.reduce((n, r) => n + r.dsl, 0);
    const json = rows.reduce((n, r) => n + r.json, 0);
    const detail = rows.map((r) => `${r.file} ${(r.json / r.dsl).toFixed(1)}x`).join(', ');
    expect(json / dsl, `${json} JSON tokens / ${dsl} DSL tokens (${detail})`).toBeGreaterThanOrEqual(t('AI_DSL_TOKEN_RATIO_MIN'));
  });
});
