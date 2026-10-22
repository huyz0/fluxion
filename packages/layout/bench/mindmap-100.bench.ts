// NFR-PERF-001, FR-LAY-003: the `mindmap` layout on 100 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { mindmapLayout } from '../src/index.js';
import { tree } from './shapes.js';
import { benchLayout } from './suite.js';

describe('mindmap layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: mindmap-100', async ({ bench }) => {
    await benchLayout(bench, 'mindmap-100', mindmapLayout, tree(100));
  });
});
