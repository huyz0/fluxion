// GitHub Actions runs for check-ci-evidence (M2.20): read through `gh` when it is installed, else
// through the REST API, both in the shape `gh run view --json databaseId,workflowName,headSha,
// conclusion,jobs` prints, so the evidence checks do not care which source answered.
import { spawnSync } from 'node:child_process';

export const REPO = 'huyz0/fluxion';
const API = 'https://api.github.com';
const FIELDS = 'databaseId,workflowName,headSha,conclusion,jobs';

/** True when a `gh` binary can be spawned at all (installed; authentication is not checked). */
export const hasGh = (spawn = spawnSync) => spawn('gh', ['--version'], { encoding: 'utf8' }).error?.code !== 'ENOENT';

/** One REST run and its jobs, mapped to the `gh run view` shape. */
export const toGhRun = (run, jobs) => ({
  databaseId: run.id,
  workflowName: run.name,
  headSha: run.head_sha,
  conclusion: run.conclusion,
  jobs: jobs.map((j) => ({ name: j.name, conclusion: j.conclusion })),
});

/**
 * REST reader. `fetch` is injected (tests pass a fake; nothing touches the network there); the
 * token, when given, is sent as a Bearer header and never logged.
 */
export function restSource({ fetch = globalThis.fetch, token, repo = REPO } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fluxion-ci-evidence' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (path) => {
    const res = await fetch(`${API}/repos/${repo}/${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub REST ${path} answered ${res.status}${token ? '' : ' (set GITHUB_TOKEN if rate-limited)'}`);
    return res.json();
  };
  return {
    view: async (id) => {
      const [run, { jobs }] = await Promise.all([get(`actions/runs/${id}`), get(`actions/runs/${id}/jobs?per_page=100`)]);
      return toGhRun(run, jobs ?? []);
    },
    list: async (sha) =>
      ((await get(`actions/runs?head_sha=${sha}&per_page=50`)).workflow_runs ?? []).map((r) => ({
        databaseId: r.id,
        workflowName: r.name,
        conclusion: r.conclusion,
      })),
  };
}

/** `gh` reader with the same interface; throws with gh's stderr when a call fails. */
export function ghSource(spawn = spawnSync) {
  const gh = (args) => {
    const r = spawn('gh', args, { encoding: 'utf8' });
    if (r.error || r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed (authenticated?): ${(r.stderr || r.error?.message || '').trim()}`);
    return JSON.parse(r.stdout);
  };
  return {
    view: async (id) => gh(['run', 'view', String(id), '--json', FIELDS]),
    list: async (sha) => gh(['run', 'list', '--commit', sha, '--limit', '50', '--json', 'databaseId,workflowName,conclusion']),
  };
}

/** gh when installed, else REST with GITHUB_TOKEN from `env` when set. */
export function runSource({ gh = hasGh(), env = process.env, fetch = globalThis.fetch, spawn = spawnSync } = {}) {
  return gh ? ghSource(spawn) : restSource({ fetch, token: env.GITHUB_TOKEN || undefined });
}
