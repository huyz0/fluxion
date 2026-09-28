import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSvg } from '@fluxion/render';
import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { E2E_TIMEOUT, fluxion, REPO } from './spawn-bin.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fluxion-render-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** `fluxion render … --json`: the exit status and the reply, parsed by the render schema. */
function render(args: readonly string[]) {
  const r = fluxion(['render', ...args, '--json']);
  const parsed = OUTPUT_SCHEMAS['render']?.safeParse(JSON.parse(r.stdout));
  expect(parsed?.success, parsed?.error?.message).toBe(true);
  return { status: r.status, reply: parsed?.data as { ok: boolean; result?: { out: string; screens: number }; errors?: { code: string }[] } };
}

describe('fluxion render (FR-CLI-001, FR-SCR-001, ADR-0015)', { timeout: E2E_TIMEOUT }, () => {
  it('FR-CLI-001: render writes the two-rects-line HTML matching the golden', () => {
    const out = join(dir, 'two-rects-line.html');
    const { status, reply } = render(['fixtures/docs/two-rects-line.flux.json', '-o', out]);
    expect(status).toBe(0);
    expect(reply.result).toEqual({ out, screens: 1 });
    const html = readFileSync(out, 'utf8');
    // a static page: no script, the content CSS inlined
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<style data-fx-content>');
    // what it draws is the render package's golden, byte for byte
    expect(normalizeSvg(html)).toBe(readFileSync(join(REPO, 'packages/render/__golden__/two-rects-line.svg'), 'utf8'));
  });

  it('FR-CLI-001: --screen keeps only the named screens; an unknown or hidden screen is a usage error', () => {
    // three screens, the last one hidden (M4.20 review F1, F2)
    const b = documentBuilder({ seed: 420 });
    const [first, second, hidden] = [b.screen({ name: 'one' }), b.screen({ name: 'two' }), b.screen({ name: 'three' })];
    b.rect(second, { label: 'On two' });
    const built = b.build();
    const doc = join(dir, 'three.flux.json');
    writeFileSync(
      doc,
      serializeDocument({ ...built, records: { ...built.records, [hidden]: { ...(built.records[hidden] as object), hidden: true } } } as DocumentFile),
    );
    const out = join(dir, 'screens.html');
    const ids = () => [...readFileSync(out, 'utf8').matchAll(/data-screen-id="([^"]+)"/g)].map((m) => m[1]);
    expect(render([doc, '-o', out]).reply.result?.screens).toBe(2);
    expect(ids()).toEqual([first, second]);
    expect(render([doc, '-o', out, '--screen', second]).reply.result?.screens).toBe(1);
    expect(ids()).toEqual([second]);
    for (const wanted of ['NoSuchScreen0000', hidden]) {
      const refused = render([doc, '-o', out, '--screen', wanted]);
      expect(refused.status, wanted).toBe(2);
      expect(refused.reply.errors?.[0]?.code).toBe('FLX_CLI_USAGE');
    }
  });

  it('FR-CLI-001: an invalid document exits 1 with its diagnostics and writes nothing; -o is required', () => {
    const out = join(dir, 'bad.html');
    const bad = render(['fixtures/docs/invalid-ref-missing.flux.json', '-o', out]);
    expect(bad.status).toBe(1);
    expect(bad.reply.errors?.map((d) => d.code)).toContain('FLX_REF_MISSING');
    expect(() => readFileSync(out)).toThrow();
    const noOut = render(['fixtures/docs/two-rects-line.flux.json']);
    expect(noOut.status).toBe(2);
    expect(noOut.reply.errors?.[0]?.code).toBe('FLX_CLI_USAGE');
    // an output path that cannot be written is an IO error (exit 1)
    const unwritable = render(['fixtures/docs/two-rects-line.flux.json', '-o', join(dir, 'no', 'such', 'dir', 'x.html')]);
    expect(unwritable.status).toBe(1);
    expect(unwritable.reply.errors?.[0]?.code).toBe('FLX_CLI_IO');
  });
});

describe('the R0 demo (FR-CLI-001, M4.22)', { timeout: E2E_TIMEOUT }, () => {
  it('FR-CLI-001: examples/r0-static.flux.json validates with no errors and renders two screens of shapes, connectors and token styles', () => {
    const validated = fluxion(['validate', 'examples/r0-static.flux.json', '--json']);
    expect(validated.status).toBe(0);
    expect(JSON.parse(validated.stdout).result.diagnostics).toEqual([]);
    const out = join(dir, 'r0-static.html');
    expect(render(['examples/r0-static.flux.json', '-o', out]).reply.result?.screens).toBe(2);
    const screens = readFileSync(out, 'utf8').split('<section class="fx-screen"').slice(1);
    expect(screens).toHaveLength(2);
    for (const screen of screens) {
      expect(screen).toContain('data-kind="shape"');
      expect(screen).toMatch(/data-kind="connector"[\s\S]*?class="fx-route"/);
    }
    // the demo's own token styles, not only the theme defaults every screen carries (review F1)
    const [first, second] = screens as [string, string];
    for (const token of ['fill:var(--fx-color-primary', 'fill:var(--fx-color-accent-1', 'stroke-width:var(--fx-stroke-thin']) expect(first).toContain(token);
    for (const token of ['fill:var(--fx-color-secondary', 'fill:var(--fx-color-accent-3']) expect(second).toContain(token);
  });
});
