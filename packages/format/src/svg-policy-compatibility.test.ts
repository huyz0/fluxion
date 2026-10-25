import { describe, expect, it } from 'vitest';
import { inspectSvg, type SvgInspection } from './sanitize-svg.js';

const fixtures = JSON.parse(
  Object.values(import.meta.glob('./__fixtures__/svg-policy-compatibility.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as readonly { path: string; expected: SvgInspection | null }[];

const sources = import.meta.glob('../../../specs/{import/corpus/svg,security/corpus}/*.svg', { query: '?raw', import: 'default', eager: true });
describe('shared SVG policy compatibility', () => {
  it('NFR-SEC-001 FR-LIB-004: every frozen SVG keeps exact sanitizer text and removal count', () => {
    expect(fixtures).toHaveLength(67);
    expect(Object.keys(sources)).toHaveLength(67);
    for (const fixture of fixtures) {
      const input = sources[`../../../${fixture.path}`];
      expect(typeof input, fixture.path).toBe('string');
      expect(inspectSvg(input as string) ?? null, fixture.path).toEqual(fixture.expected);
    }
  });
});
