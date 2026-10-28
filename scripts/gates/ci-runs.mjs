// GitHub Actions runs for check-ci-evidence (M2.20): read through `gh` when it is installed, else
// through the REST API, both in the shape `gh run view --json databaseId,workflowName,headSha,
// conclusion,jobs` prints, so the evidence checks do not care which source answered.
import { spawnSync } from 'node:child_process';

export const REPO = 'huyz0/fluxion';
const API = 'https://api.github.com';
const FIELDS = 'databaseId,workflowName,headSha,conclusion,jobs';
const RUN_FIELDS = 'databaseId,workflowName,headSha,status,conclusion,createdAt';

/** True when a `gh` binary can be spawned at all (installed; authentication is not checked). */
export const hasGh = (spawn = spawnSync) => spawn('gh', ['--version'], { encoding: 'utf8' }).error?.code !== 'ENOENT';

/** One REST run and its jobs, mapped to the `gh run view` shape. */
export const toGhRun = (run, jobs) => ({
  databaseId: run.id,
  workflowName: run.name,
  headSha: run.head_sha,
  conclusion: run.conclusion,
  // steps with their times: check-budget --cold-from-ci reads the cold-setup step's duration
  jobs: jobs.map((j) => ({
    name: j.name,
    conclusion: j.conclusion,
    steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion, startedAt: s.started_at, completedAt: s.completed_at })),
  })),
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
    // newest first, with status, pushes only (a PR from a fork's main is not main): the loop reads
    // main's last runs before a task (M5.2)
    branch: async (name) =>
      ((await get(`actions/runs?branch=${encodeURIComponent(name)}&event=push&per_page=30`)).workflow_runs ?? []).map((r) => ({
        databaseId: r.id,
        workflowName: r.name,
        headSha: r.head_sha,
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
        // last-ci reads a pending fix's Fixes-ci trailer from it (M18.118); gh's run list has no message
        ...(typeof r.head_commit?.message === 'string' && { message: r.head_commit.message }),
      })),
    // a workflow's newest completed push run: no fixed-size window of mixed workflows can hide it (M18.134, cp14 F1)
    completed: async (name, file) =>
      ((await get(`actions/workflows/${file}/runs?branch=${encodeURIComponent(name)}&event=push&status=completed&per_page=1`)).workflow_runs ?? []).map(
        (r) => ({ databaseId: r.id, workflowName: r.name, headSha: r.head_sha, status: r.status, conclusion: r.conclusion, createdAt: r.created_at }),
      ),
    // a run's cold-setup job and its log text (null when unreadable): last-ci reports it while it is continue-on-error (M18.161)
    coldSetup: async (id) => {
      const job = ((await get(`actions/runs/${id}/jobs?per_page=100`)).jobs ?? []).find((j) => j.name === 'cold-setup');
      if (!job) return undefined;
      const res = await fetch(`${API}/repos/${repo}/actions/jobs/${job.id}/logs`, { headers }).catch(() => undefined);
      return { conclusion: job.conclusion, log: res?.ok ? await res.text() : null };
    },
    // the nightly's last runs on the branch, scheduled or dispatched (not pushes): last-ci reports them (M18.124)
    nightly: async (name) =>
      ((await get(`actions/workflows/nightly.yml/runs?branch=${encodeURIComponent(name)}&per_page=5`)).workflow_runs ?? []).map((r) => ({
        databaseId: r.id,
        workflowName: r.name,
        headSha: r.head_sha,
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
      })),
  };
}

/** Older gh versions omit step times; request only the exact successful cold job. */
function hydrateColdStepTimes(job, runId, gh) {
  if (job.name !== 'cold-setup' || job.conclusion !== 'success') return;
  if (!(job.steps ?? []).some((step) => !step.startedAt || !step.completedAt)) return;
  if (!Number.isSafeInteger(job.databaseId) || job.databaseId <= 0) throw new Error('cold-setup job identity missing');
  const detail = gh(['api', `repos/${REPO}/actions/jobs/${job.databaseId}`]);
  if (detail.id !== job.databaseId || detail.run_id !== Number(runId) || detail.name !== job.name) throw new Error('cold-setup job identity mismatch');
  job.steps = (detail.steps ?? []).map((step) => ({
    name: step.name,
    conclusion: step.conclusion,
    startedAt: step.started_at,
    completedAt: step.completed_at,
  }));
}

/** `gh` reader with the same interface; throws with gh's stderr when a call fails. */
export function ghSource(spawn = spawnSync) {
  const gh = (args) => {
    const r = spawn('gh', args, { encoding: 'utf8' });
    if (r.error || r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed (authenticated?): ${(r.stderr || r.error?.message || '').trim()}`);
    return JSON.parse(r.stdout);
  };
  return {
    view: async (id) => {
      const run = gh(['run', 'view', String(id), '--json', FIELDS]);
      for (const job of run.jobs ?? []) hydrateColdStepTimes(job, id, gh);
      return run;
    },
    list: async (sha) => gh(['run', 'list', '--commit', sha, '--limit', '50', '--json', 'databaseId,workflowName,conclusion']),
    branch: async (name) =>
      gh(['run', 'list', '--branch', name, '--event', 'push', '--limit', '30', '--json', 'databaseId,workflowName,headSha,status,conclusion,createdAt']),
    completed: async (name, file) =>
      gh(['run', 'list', '--workflow', file, '--branch', name, '--event', 'push', '--status', 'completed', '--limit', '1', '--json', RUN_FIELDS]),
    coldSetup: async (id) => {
      const job = (gh(['run', 'view', String(id), '--json', 'jobs']).jobs ?? []).find((j) => j.name === 'cold-setup');
      if (!job) return undefined;
      const log = spawn('gh', ['api', `repos/${REPO}/actions/jobs/${job.databaseId}/logs`], { encoding: 'utf8', maxBuffer: 1 << 26 });
      return { conclusion: job.conclusion, log: log.status === 0 ? log.stdout : null };
    },
    nightly: async (name) =>
      gh([
        'run',
        'list',
        '--workflow',
        'nightly.yml',
        '--branch',
        name,
        '--limit',
        '5',
        '--json',
        'databaseId,workflowName,headSha,status,conclusion,createdAt',
      ]),
  };
}

/**
 * Hint appended to a transport failure: Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1,
 * so a REST read behind a proxy fails although gh or curl work (M2 final F5). '' when not relevant.
 */
export function transportHint({ env = process.env, gh = hasGh() } = {}) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (gh || !proxy || env.NODE_USE_ENV_PROXY === '1') return '';
  return ' (HTTPS_PROXY is set, but Node fetch ignores it unless NODE_USE_ENV_PROXY=1)';
}

/** gh when installed, else REST with GITHUB_TOKEN from `env` when set. */
export function runSource({ gh = hasGh(), env = process.env, fetch = globalThis.fetch, spawn = spawnSync } = {}) {
  return gh ? ghSource(spawn) : restSource({ fetch, token: env.GITHUB_TOKEN || undefined });
}
