import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { registerLintRules } from '../lint/lint.js';
import { type LlmChunk, type LlmClient, LlmError, type LlmRequest } from './llm.js';
import { type GenerateEvent, generateDeck, MAX_REPAIRS, parseOutline, unfence } from './orchestrate.js';

function registries() {
  const r = createCoreRegistries();
  r.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}

const OUTLINE = JSON.stringify({
  title: 'Plan',
  screens: [
    { id: 'intro', title: 'Intro', intent: 'say hello' },
    { id: 'next', title: 'Next', intent: 'what is next' },
  ],
});
const GOOD = (id: string) => `- id: ${id}\n  nodes:\n    a: { shape: rect }\n    b: { shape: rect }\n  edges:\n    - a -> b\n`;
const BROKEN = (id: string) => `- id: ${id}\n  nodes:\n    a: { shape: rectangle }\n`;
const BAD_BACKGROUND = (id: string) => `- id: ${id}\n  background: notacolor\n  nodes:\n    x: { shape: rect }\n`;

/** A client that answers each request with the next scripted reply, split into small chunks, and records the requests. */
function scripted(replies: readonly string[]): { client: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let i = 0;
  const client: LlmClient = {
    id: 'scripted',
    capabilities: { structuredOutput: false, vision: false },
    async *stream(request): AsyncIterable<LlmChunk> {
      requests.push(request);
      const reply = replies[i++] ?? '';
      for (let at = 0; at < reply.length; at += 7) yield { type: 'text', text: reply.slice(at, at + 7) };
      yield { type: 'usage', tokensIn: 10, tokensOut: 5 };
      yield { type: 'done' };
    },
  };
  return { client, requests };
}

const options = (client: LlmClient, extra: object = {}) => ({ client, system: 'SYS', compile: { registries: registries() }, prompt: 'make a plan', ...extra });

describe('generateDeck (FR-AI-009, FR-AI-004, ADR-0041)', () => {
  it('FR-AI-009: a deck of valid screens takes one request for the outline and one per screen, with no repair', async () => {
    const { client, requests } = scripted([OUTLINE, GOOD('intro'), GOOD('next')]);
    const r = await generateDeck(options(client));
    expect(requests).toHaveLength(3);
    expect(r.screens).toEqual([
      { id: 'intro', rounds: 0, lenient: false, ok: true },
      { id: 'next', rounds: 0, lenient: false, ok: true },
    ]);
    expect(Object.values(r.doc?.records ?? {}).filter((x) => x.type === 'screen')).toHaveLength(2);
    expect(r.usage).toEqual({ tokensIn: 30, tokensOut: 15 });
    expect(requests[0]?.system).toBe('SYS');
    // NFR-A11Y-006: the screen request asks for alt text and reading order
    expect(requests[1]?.messages[0]?.content).toMatch(/alt:.*reading order/s);
  });

  it('FR-AI-004: a broken screen is sent back with the formatted diagnostics and repaired in round 1', async () => {
    const { client, requests } = scripted([OUTLINE, BROKEN('intro'), GOOD('intro'), GOOD('next')]);
    const events: GenerateEvent[] = [];
    const r = await generateDeck(options(client, { onEvent: (e: GenerateEvent) => events.push(e) }));
    expect(r.screens[0]).toEqual({ id: 'intro', rounds: 1, lenient: false, ok: true });
    const repair = requests[2]?.messages.at(-1)?.content ?? '';
    expect(repair).toContain('FLX_');
    expect(repair).toContain('rectangle');
    expect(events.filter((e) => e.type === 'repair')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'screen-text').length).toBeGreaterThan(2);
  });

  it('FR-AI-004: after two failed repairs the screen compiles leniently and its auto-fixes are warnings', async () => {
    const { client, requests } = scripted([OUTLINE, BAD_BACKGROUND('intro'), BAD_BACKGROUND('intro'), BAD_BACKGROUND('intro'), GOOD('next')]);
    const r = await generateDeck(options(client));
    expect(MAX_REPAIRS).toBe(2);
    expect(requests).toHaveLength(5);
    expect(r.screens[0]).toEqual({ id: 'intro', rounds: 2, lenient: true, ok: true });
    expect(r.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('FR-AI-004: a screen that stays broken even leniently is left out and reported, and the deck goes on', async () => {
    const { client } = scripted([OUTLINE, BROKEN('intro'), BROKEN('intro'), BROKEN('intro'), GOOD('next')]);
    const r = await generateDeck(options(client));
    expect(r.screens.map((s) => s.ok)).toEqual([false, true]);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(Object.values(r.doc?.records ?? {}).filter((x) => x.type === 'screen')).toHaveLength(1);
  });

  it('FR-AI-009: a reply that is not the outline JSON stops the run with one error and no document', async () => {
    const { client, requests } = scripted(['Sure! Here is a plan.']);
    const r = await generateDeck(options(client));
    expect(r.doc).toBeUndefined();
    expect(r.screens).toEqual([]);
    expect(r.diagnostics[0]?.severity).toBe('error');
    expect(requests).toHaveLength(1);
  });

  it('FR-AI-009: an aborted signal throws an aborted LlmError before any request', async () => {
    const { client, requests } = scripted([OUTLINE]);
    const signal = { aborted: true, addEventListener: () => undefined, removeEventListener: () => undefined };
    await expect(generateDeck(options(client, { signal }))).rejects.toMatchObject({ code: 'aborted' });
    expect(requests).toHaveLength(0);
  });

  it('FR-AI-009: a provider failure propagates as the LlmError it threw', async () => {
    const client: LlmClient = {
      id: 'down',
      capabilities: { structuredOutput: false, vision: false },
      // biome-ignore lint/correctness/useYield: the stream fails before it yields
      async *stream() {
        throw new LlmError('rate-limit', 429);
      },
    };
    await expect(generateDeck(options(client))).rejects.toThrow('llm rate-limit (HTTP 429)');
  });

  it('FR-AI-009: fenced replies are unwrapped, and a full file with screens: is used as it is', async () => {
    const full = `\`\`\`yaml\nflux: 1\ntitle: T\nuses: [basic]\nscreens:\n${'  '}${GOOD('intro').replaceAll('\n', '\n  ').trimEnd()}\n\`\`\``;
    const { client } = scripted([`\`\`\`json\n${OUTLINE}\n\`\`\``, full, GOOD('next')]);
    const r = await generateDeck(options(client));
    expect(r.screens.map((s) => s.ok)).toEqual([true, true]);
    expect(unfence('```yaml\nx: 1\n```')).toBe('x: 1');
    expect(unfence('plain')).toBe('plain');
  });

  it('FR-AI-009: parseOutline refuses an empty list, a bad slug and non-JSON', () => {
    expect(parseOutline('{"title":"t","screens":[]}')).toBeUndefined();
    expect(parseOutline('{"title":"t","screens":[{"id":"Bad Id"}]}')).toBeUndefined();
    expect(parseOutline('nope')).toBeUndefined();
    expect(parseOutline('{"title":"t","screens":[{"id":"a"}]}')?.screens[0]).toEqual({ id: 'a', title: 'a', intent: '' });
  });

  it('NFR-SEC-004: an LlmError message holds the code and status only', () => {
    const e = new LlmError('auth', 401);
    expect(e.message).toBe('llm auth (HTTP 401)');
    expect(e.code).toBe('auth');
    expect(new LlmError('network').message).toBe('llm network');
  });

  it('FR-AI-005: with a lint registry the result carries the score of the final document', async () => {
    const regs = registries();
    registerLintRules(regs.lintRules);
    const { client } = scripted([OUTLINE, GOOD('intro'), GOOD('next')]);
    const r = await generateDeck({ ...options(client), compile: { registries: regs }, lintRegistry: regs.lintRules });
    expect(r.lint?.score).toBeGreaterThan(0);
    expect(r.lint?.score).toBeLessThanOrEqual(100);
  });
});
