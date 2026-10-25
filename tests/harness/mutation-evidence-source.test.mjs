// NFR-MNT-005: read only supported metadata/annotation endpoints, with complete pagination.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evidenceReader, readMutationEvidence } from '../../scripts/ci/mutation-evidence-source.mjs';

describe('mutation evidence transport (NFR-MNT-005)', () => {
  it('reads all job and annotation pages using the actual aggregate check-run URL', async () => {
    const calls = [];
    const responses = {
      'actions/runs/123': { id: 123 },
      'actions/runs/123/jobs?per_page=100&page=1': {
        jobs: [
          { name: 'mutation', id: 7, check_run_url: 'https://api.github.com/repos/huyz0/fluxion/check-runs/999' },
          ...Array.from({ length: 99 }, (_, i) => ({ name: `job${i}` })),
        ],
      },
      'actions/runs/123/jobs?per_page=100&page=2': { jobs: [{ name: 'last' }] },
      'check-runs/999/annotations?per_page=100&page=1': Array(100).fill({ message: 'other' }),
      'check-runs/999/annotations?per_page=100&page=2': [{ message: 'last' }],
    };
    const get = async (path) => {
      calls.push(path);
      assert.ok(Object.hasOwn(responses, path), path);
      return responses[path];
    };
    const result = await readMutationEvidence(123, { get });
    assert.equal(result.jobs.length, 101);
    assert.equal(result.annotations.length, 101);
    assert.equal(calls.length, 5);
    assert.ok(calls.every((p) => !p.includes('/logs') && !p.includes('/artifacts')));
  });
  it('does not retry a denied read or switch to another retrieval route', async () => {
    let count = 0;
    await assert.rejects(
      () =>
        readMutationEvidence(123, {
          get: async () => {
            count++;
            throw new Error('Forbidden');
          },
        }),
      /Forbidden/,
    );
    assert.equal(count, 1);
  });
  it('rejects missing, duplicate or off-repository aggregate check identities', async () => {
    for (const jobs of [[], [{ name: 'mutation' }, { name: 'mutation' }], [{ name: 'mutation', check_run_url: 'https://example.invalid/check-runs/1' }]]) {
      const calls = [];
      await assert.rejects(() =>
        readMutationEvidence(123, {
          get: async (path) => {
            calls.push(path);
            return path === 'actions/runs/123' ? { id: 123 } : { jobs };
          },
        }),
      );
      assert.equal(calls.length, 2);
    }
  });
});

it('NFR-MNT-005: a denied gh read never falls back to REST', async () => {
  let calls = 0;
  const get = evidenceReader({
    gh: true,
    spawn: () => {
      calls++;
      return { status: 1, stderr: 'Forbidden' };
    },
    fetch: () => {
      throw new Error('unexpected fallback');
    },
  });
  await assert.rejects(get('actions/runs/123'), /Forbidden/);
  assert.equal(calls, 1);
});
