// Read-only GitHub metadata and check annotations. No logs/artifact downloads or transport retries.
import { spawnSync } from 'node:child_process';
import { hasGh, REPO } from '../gates/ci-runs.mjs';

export function evidenceReader({ spawn = spawnSync, fetch = globalThis.fetch, env = process.env, gh = hasGh(spawn) } = {}) {
  if (gh)
    return async (path) => {
      const result = spawn('gh', ['api', `repos/${REPO}/${path}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error(`GitHub metadata read failed: ${result.stderr || result.error?.message}`);
      return JSON.parse(result.stdout);
    };
  return async (path) => {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fluxion-mutation-evidence' };
    const token = env.GITHUB_TOKEN || env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const result = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers, signal: AbortSignal.timeout(30000) });
    if (!result.ok) throw new Error(`GitHub metadata ${path} answered ${result.status}`);
    return result.json();
  };
}

async function pages(get, path, key) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const response = await get(`${path}?per_page=100&page=${page}`);
    const items = key ? response?.[key] : response;
    if (!Array.isArray(items)) throw new Error('malformed GitHub metadata page');
    all.push(...items);
    if (items.length < 100) return all;
  }
  throw new Error('GitHub metadata pagination exceeded limit; evidence is incomplete');
}

export async function readMutationEvidence(runId, { get = evidenceReader() } = {}) {
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('invalid run ID');
  const run = await get(`actions/runs/${runId}`);
  const jobs = await pages(get, `actions/runs/${runId}/jobs`, 'jobs');
  const aggregate = jobs.filter((j) => j.name === 'mutation');
  if (aggregate.length !== 1) throw new Error('missing or duplicate aggregate job');
  const prefix = `https://api.github.com/repos/${REPO}/check-runs/`;
  const url = aggregate[0].check_run_url;
  if (typeof url !== 'string' || !url.startsWith(prefix) || !/^\d+$/.test(url.slice(prefix.length))) throw new Error('invalid aggregate check-run identity');
  const annotations = await pages(get, `check-runs/${url.slice(prefix.length)}/annotations`);
  return { run, jobs, annotations };
}
