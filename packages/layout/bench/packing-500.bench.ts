// NFR-PERF-001, FR-LAY-003: the `packing` layout on 500 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { packingLayout } from '../src/index.js';
import { graph } from './graph.js';
import { benchLayout } from './suite.js';

describe('packing layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: packing-500', async ({ bench }) => {
    await benchLayout(bench, 'packing-500', packingLayout, graph(500));
  });
});
