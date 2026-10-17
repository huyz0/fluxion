// FR-MCP-001, FR-MCP-002, NFR-AI-001: the R2 demo deck compiles to ten screens, scores at least AI_LINT_SCORE_MIN, builds to a page that holds
// every screen, and has its scripted MCP transcript (replayed against the real server by packages/mcp/src/e2e/r2-demo.test.ts).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error the gate thresholds are plain JavaScript
import { t } from '../gates/thresholds.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const BIN = join(REPO, 'packages/cli/dist/bin.js');
const DECK = 'examples/r2-ai-deck.flux.yaml';
let dir = '';
const flux = (...args: string[]) => {
  if (!existsSync(BIN)) throw new Error(`${BIN} is missing: run pnpm run build first`);
  const r = spawnSync(process.execPath, [BIN, ...args, '--json'], { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, reply: JSON.parse(r.stdout) as { ok: boolean; result?: { [key: string]: unknown } } };
};

describe('the R2 demo deck (FR-MCP-001, FR-MCP-002)', { timeout: 60_000 }, () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-r2-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('FR-MCP-002: the deck compiles to ten screens with no error', () => {
    const r = flux('compile', DECK, '-o', join(dir, 'deck.flux.json'));
    expect(r.status).toBe(0);
    expect(r.reply.result?.['screens']).toBe(10);
  });

  it('NFR-AI-001: the deck scores at least AI_LINT_SCORE_MIN', () => {
    const compiled = join(dir, 'lint.flux.json');
    expect(flux('compile', DECK, '-o', compiled).status).toBe(0);
    const r = flux('lint', compiled);
    expect(Number(r.reply.result?.['score'])).toBeGreaterThanOrEqual(t('AI_LINT_SCORE_MIN'));
  });

  it('FR-MCP-001: the built page holds all ten screens', () => {
    const compiled = join(dir, 'page.flux.json');
    const page = join(dir, 'deck.html');
    expect(flux('compile', DECK, '-o', compiled).status).toBe(0);
    expect(flux('render', compiled, '-o', page).reply.result?.['screens']).toBe(10);
    expect(readFileSync(page, 'utf8').match(/class="fx-screen[ "]/g)).toHaveLength(10);
  });

  it('FR-MCP-001: the transcript says it is scripted and lists the six calls', () => {
    const text = readFileSync(join(REPO, 'examples/r2-ai-deck.transcript.md'), 'utf8');
    expect(text).toContain('**scripted**');
    expect(text.match(/^ {3}reply: /gm)).toHaveLength(6);
  });
});
