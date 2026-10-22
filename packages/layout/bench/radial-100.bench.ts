// NFR-PERF-001, FR-LAY-003: the `radial` layout on 100 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { radialLayout } from '../src/index.js';
import { tree } from './shapes.js';
import { benchLayout } from './suite.js';

describe('radial layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: radial-100', async ({ bench }) => {
    await benchLayout(bench, 'radial-100', radialLayout, tree(100));
  });
});
