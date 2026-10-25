import { expect, it, vi } from 'vitest';

function failureOf(parse: () => unknown): unknown {
  try {
    parse();
  } catch (error) {
    return error;
  }
  throw new Error('Expected a path-template failure');
}

it('NFR-PERF-002: the path-template cache reuses parses and failures but evicts at 1024 entries', async () => {
  vi.resetModules();
  const { parseTemplate, TemplateFailure } = await import('./template.js');
  const good = () => parseTemplate('M 0 0 L 1 1', ['bounded-cache', 'good']);
  const bad = () => failureOf(() => parseTemplate('?', ['bounded-cache', 'bad']));
  const parsed = good();
  const failed = bad();
  expect(failed).toBeInstanceOf(TemplateFailure);
  expect(failed).toMatchObject({ diagnostic: { code: 'FLX_SHAPE_PATH', severity: 'error', path: '/bounded-cache/bad' } });
  // These distinct inputs plus the successful and failed entries fill the existing capacity.
  for (let i = 0; i < 1022; i++) parseTemplate(`M ${i} 0`, ['bounded-cache', i]);
  expect(good()).toBe(parsed);
  expect(bad()).toBe(failed);
  parseTemplate('M 0 0', ['bounded-cache', 'overflow']);
  const reparsed = good();
  const refailed = bad();
  expect(reparsed).not.toBe(parsed);
  expect(refailed).not.toBe(failed);
  expect(reparsed).toEqual(parsed);
  expect(refailed).toEqual(failed);
});
