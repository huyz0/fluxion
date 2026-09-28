import { describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { fluxion } from './spawn-bin.js';

type Reply = {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly errors?: readonly { readonly code: string; readonly severity: string; readonly path: string; readonly message: string }[];
  readonly result?: { readonly diagnostics: readonly { readonly code: string; readonly severity: string; readonly path: string }[] };
};

/** `fluxion validate <file> --json`: the exit status and the reply, parsed by the validate schema. */
function validate(file: string): { status: number | null; reply: Reply; stderr: string } {
  const r = fluxion(['validate', file, '--json']);
  const parsed = OUTPUT_SCHEMAS['validate']?.safeParse(JSON.parse(r.stdout));
  expect(parsed?.success, parsed?.error?.message).toBe(true);
  return { status: r.status, reply: parsed?.data as Reply, stderr: r.stderr };
}

describe('fluxion validate (FR-CLI-001, ADR-0147)', () => {
  it('FR-CLI-001: validate reports JSON-pointer diagnostics and exits 1', () => {
    for (const fixture of ['invalid-ref-missing', 'invalid-schema-invalid']) {
      const { status, reply, stderr } = validate(`fixtures/docs/${fixture}.flux.json`);
      expect(status, fixture).toBe(1);
      expect(reply.ok).toBe(false);
      expect(reply.errors?.length, fixture).toBeGreaterThan(0);
      // every diagnostic points into the document with a JSON pointer, and the named code is among them
      for (const d of reply.errors ?? []) expect(d.path, fixture).toMatch(/^(\/[^/]*)*$/);
      expect(reply.errors?.map((d) => d.code)).toContain(`FLX_${fixture.replace('invalid-', '').toUpperCase().replaceAll('-', '_')}`);
      expect(stderr).toMatch(/: \d+ errors?/);
      expect(reply, fixture).toMatchSnapshot();
    }
  });

  it('FR-CLI-001: without --json, every diagnostic with its JSON pointer goes to stderr and stdout stays empty', () => {
    const r = fluxion(['validate', 'fixtures/docs/invalid-ref-missing.flux.json']);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('error FLX_REF_MISSING /records/DhGD9zA_E_hMrDx6/screenId: no record');
    expect(r.stderr).toContain('invalid-ref-missing.flux.json: 1 error');
  });

  it('FR-CLI-001: a valid document exits 0 with its warnings as the result', () => {
    const clean = validate('fixtures/docs/two-rects-line.flux.json');
    expect(clean.status).toBe(0);
    expect(clean.reply.result?.diagnostics).toEqual([]);
    expect(clean.stderr).toBe('fixtures/docs/two-rects-line.flux.json: valid\n');
    const warned = validate('fixtures/docs/unknown-kind.flux.json');
    expect(warned.status).toBe(0);
    expect(warned.reply.result?.diagnostics.map((d) => d.code)).toContain('FLX_KIND_UNKNOWN');
    expect(warned.reply.result?.diagnostics.every((d) => d.severity !== 'error')).toBe(true);
  });

  it('FR-CLI-001: a missing file is an IO error (exit 1); a missing or extra argument is a usage error (exit 2)', () => {
    const missing = validate('fixtures/docs/nope.flux.json');
    expect(missing.status).toBe(1);
    expect(missing.reply.errors).toEqual([expect.objectContaining({ code: 'FLX_CLI_IO', path: '/argv' })]);
    expect(fluxion(['validate']).status).toBe(2);
    expect(fluxion(['validate', 'a.json', 'b.json']).status).toBe(2);
  });
});
