import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('FR-LIB-004 NFR-SEC-001: the shipped browser artifact exposes the actual witness without import-time DOM effects', () => {
  const code = readFileSync(new URL('../dist/svg-witness.browser.js', import.meta.url), 'utf8');
  const timer = vi.fn();
  const context: Record<string, unknown> = { TextEncoder, TextDecoder, setTimeout: timer, clearTimeout: vi.fn() };
  Object.defineProperty(context, 'document', {
    get() {
      throw Error('import-time DOM access');
    },
  });
  runInNewContext(code, context, { timeout: 5000 });
  const api = context['FluxionSvgWitness'] as { createSvgPaintWitness?: unknown };
  expect(api.createSvgPaintWitness).toBeTypeOf('function');
  expect(timer).not.toHaveBeenCalled();
});
it('NFR-LIC-001: the shipped browser artifact includes third-party license texts', () => {
  const notices = readFileSync(new URL('../dist/svg-witness.LICENSES.md', import.meta.url), 'utf8');
  for (const name of ['react', 'react-dom', 'scheduler', 'zod', 'alien-signals']) expect(notices).toContain(name);
  expect(notices).toContain('Permission is hereby granted');
  expect(notices).toContain('copyright');
});
