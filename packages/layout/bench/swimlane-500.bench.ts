// NFR-PERF-001, FR-LAY-003: the `swimlane` layout on 500 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { swimlaneLayout } from '../src/index.js';
import { laned } from './shapes.js';
import { benchLayout } from './suite.js';

describe('swimlane layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: swimlane-500', async ({ bench }) => {
    await benchLayout(bench, 'swimlane-500', swimlaneLayout, laned(500));
  });
});
