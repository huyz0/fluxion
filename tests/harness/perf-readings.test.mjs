import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readings } from '../../scripts/ci/perf-readings.mjs';
import { out, sandbox } from './helpers.mjs';

// M18.131: the nightly perf job prints its specs' fps annotations on a pass, since only a failure uploads the report
const report = {
  suites: [
    {
      title: 'perf.route-drag-200.spec.ts',
      file: 'perf.route-drag-200.spec.ts',
      specs: [],
      suites: [
        {
          title: 'connector drag performance',
          specs: [
            {
              title: 'FR-RTE-002: dragging a shape with 200 connectors',
              tests: [
                {
                  projectName: 'perf',
                  annotations: [{ type: 'drag fps', description: '57.3' }],
                  results: [{ annotations: [{ type: 'drag fps', description: '57.3' }] }],
                },
              ],
            },
            {
              title: 'NFR-PERF-002: a screen of 2,000 elements and 1,000 connectors is drawn',
              tests: [{ projectName: 'perf', annotations: [{ type: 'first render ms', description: '835' }], results: [] }],
            },
            { title: 'no reading', tests: [{ projectName: 'perf', annotations: [{ type: 'issue', description: 'x' }], results: [] }] },
          ],
        },
      ],
    },
  ],
};

describe('nightly perf readings (FR-RTE-002, NFR-PERF-002)', () => {
  it('each fps or ms annotation is one line, once, named by file, title and project; other annotations are left out (M18.288)', () => {
    assert.deepEqual(readings(report), [
      'perf.route-drag-200.spec.ts › FR-RTE-002: dragging a shape with 200 connectors [perf]: drag fps 57.3',
      'perf.route-drag-200.spec.ts › NFR-PERF-002: a screen of 2,000 elements and 1,000 connectors is drawn [perf]: first render ms 835',
    ]);
    assert.deepEqual(readings({}), []);
  });

  it('the command prints them and never fails, even with no report', () => {
    const sb = sandbox(['scripts/ci']);
    try {
      sb.write('e2e.json', JSON.stringify(report));
      const r = sb.node('scripts/ci/perf-readings.mjs', [sb.path('e2e.json')]);
      assert.equal(r.status, 0, out(r));
      assert.match(r.stdout, /^perf-readings: perf\.route-drag-200\.spec\.ts › .* \[perf\]: drag fps 57\.3$/m);
      assert.match(r.stdout, /^perf-readings: .* \[perf\]: first render ms 835$/m);
      const missing = sb.node('scripts/ci/perf-readings.mjs', [sb.path('missing.json')]);
      assert.equal(missing.status, 0, out(missing));
      assert.match(missing.stdout, /could not read/);
    } finally {
      sb.cleanup();
    }
  });
});
