// GitHub Actions runs for check-ci-evidence (M2.20): read through `gh` when it is installed, else
// through the REST API, both in the shape `gh run view --json databaseId,workflowName,headSha,
// conclusion,jobs` prints, so the evidence checks do not care which source answered.
import { spawnSync } from 'node:child_process';

export const REPO = 'huyz0/fluxion';
const API = 'https://api.github.com';
const FIELDS = 'databaseId,workflowName,headSha,headBranch,conclusion,jobs';
const RUN_FIELDS = 'databaseId,workflowName,headSha,status,conclusion,createdAt';
/** Runs per page when ci's runs are paged (GitHub's maximum). */
/** How many of a workflow's newest completed push runs `completed` reads (M18.188). */
export const COMPLETED_RUNS = 10;
export const PAGE_SIZE = 100;
/** The REST path of page `page` of ci's push runs on branch `name`; gh reads the same path through `gh api`. */
const ciPagePath = (name, page, size) => `actions/workflows/ci.yml/runs?branch=${encodeURIComponent(name)}&event=push&per_page=${size}&page=${page}`;
/** A REST run in the `gh run list` shape, with its commit message when the answer has one. */
const listed = (r) => ({
  databaseId: r.id,
  workflowName: r.name,
  headSha: r.head_sha,
  status: r.status,
  conclusion: r.conclusion,
  createdAt: r.created_at,
  // last-ci reads a pending fix's Fixes-ci trailer from it (M18.118); gh's run list has no message
  ...(typeof r.head_commit?.message === 'string' && { message: r.head_commit.message }),
});

/** True when a `gh` binary can be spawned at all (installed; authentication is not checked). */
export const hasGh = (spawn = spawnSync) => spawn('gh', ['--version'], { encoding: 'utf8' }).error?.code !== 'ENOENT';

/** One REST run and its jobs, mapped to the `gh run view` shape. */
export const toGhRun = (run, jobs) => ({
  databaseId: run.id,
  workflowName: run.name,
  headSha: run.head_sha,
  conclusion: run.conclusion,
  // last-ci checks that a run a fix names ran on the branch (M18.200)
  ...(typeof run.head_branch === 'string' && { headBranch: run.head_branch }),
  // steps with their times: check-budget --cold-from-ci reads the cold-setup step's duration
  jobs: jobs.map((j) => ({
    name: j.name,
    conclusion: j.conclusion,
    steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion, startedAt: s.started_at, completedAt: s.completed_at })),
  })),
});

/** The most pages of a run's jobs read: a nightly holds over 100 jobs, so one page is not all of them (M19.55, cp7 F2). */
export const JOB_PAGES = 20;
/** Every job of run `id`, page by page through `get(path)` (REST answers at most 100 a page), until a page comes back short. */
export async function pagedJobs(get, id) {
  const all = [];
  for (let page = 1; page <= JOB_PAGES; page++) {
    // the first page as it was always asked for; later pages say which
    const jobs = (await get(`actions/runs/${id}/jobs?per_page=${PAGE_SIZE}${page === 1 ? '' : `&page=${page}`}`)).jobs ?? [];
    all.push(...jobs);
    if (jobs.length < PAGE_SIZE) return all;
  }
  throw new Error(`run ${id} has more than ${JOB_PAGES * PAGE_SIZE} jobs`);
}

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
      const [run, jobs] = await Promise.all([get(`actions/runs/${id}`), pagedJobs(get, id)]);
      return toGhRun(run, jobs);
    },
    list: async (sha) =>
      ((await get(`actions/runs?head_sha=${sha}&per_page=50`)).workflow_runs ?? []).map((r) => ({
        databaseId: r.id,
        workflowName: r.name,
        conclusion: r.conclusion,
      })),
    // newest first, with status, pushes only (a PR from a fork's main is not main): the loop reads
    // main's last runs before a task (M5.2)
    branch: async (name) => ((await get(`actions/runs?branch=${encodeURIComponent(name)}&event=push&per_page=30`)).workflow_runs ?? []).map(listed),
    // one page of ci's push runs, newest first: the same-tree reads page back to a tree's start (M18.199, cp26 F1)
    ciPage: async (name, page, size = PAGE_SIZE) => ((await get(ciPagePath(name, page, size))).workflow_runs ?? []).map(listed),
    // a workflow's newest completed push runs: no fixed-size window of mixed workflows can hide them (M18.134, cp14 F1). Ten,
    // not one: the newest may be queued runs a newer push replaced (ADR-0208, M18.188), and last-ci skips those
    completed: async (name, file) =>
      (
        (await get(`actions/workflows/${file}/runs?branch=${encodeURIComponent(name)}&event=push&status=completed&per_page=${COMPLETED_RUNS}`)).workflow_runs ??
        []
      ).map((r) => ({ databaseId: r.id, workflowName: r.name, headSha: r.head_sha, status: r.status, conclusion: r.conclusion, createdAt: r.created_at })),
    // a run's jobs and their conclusions, read while it is still pending: last-ci sees a failed job early (M18.191)
    // with their steps: a cancelled job with none is one no runner acquired (infra-miss.mjs, M20.37)
    jobs: async (id) => (await pagedJobs(get, id)).map((j) => ({ name: j.name, conclusion: j.conclusion, steps: j.steps ?? null })),
    // a run's cold-setup job, its cold step's duration and its log text (null when unknown): last-ci reports them (M18.161, M18.164)
    coldSetup: async (id) => {
      const job = (await pagedJobs(get, id)).find((j) => j.name === 'cold-setup');
      if (!job) return undefined;
      const res = await fetch(`${API}/repos/${repo}/actions/jobs/${job.id}/logs`, { headers }).catch(() => undefined);
      const step = (job.steps ?? []).find((s) => s.name === COLD_STEP);
      return { conclusion: job.conclusion, ms: stepMs(step?.started_at, step?.completed_at), log: res?.ok ? await res.text() : null };
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

/** ci's step that runs check-budget --cold, and its duration in ms (null when a time is missing or unparsable). */
const COLD_STEP = 'cold setup within COLD_SETUP_MAX_MS';
const stepMs = (start, end) => {
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

/** The cold run's duration in ms and whether the log calls it over budget; ms null when unknown (last-ci, and
 * m20-complete's cold-setup leg through ciColdReadings, M20.28). */
export function coldDuration(cold) {
  const log = typeof cold.log === 'string' ? cold.log : '';
  const over =
    /(?:::warning title=cold setup over budget::|##\[warning\])cold setup (\d+) ms >/.exec(log) ?? /budget: cold setup failed by time \((\d+) ms >/.exec(log);
  if (over) return { ms: Number(over[1]), over: true };
  // check-budget's own measure wins over the step's, which also counts the step's start-up
  const within = /budget: cold setup (\d+) ms <= /.exec(log);
  return { ms: within ? Number(within[1]) : Number.isFinite(cold.ms) ? cold.ms : null, over: false };
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

/**
 * `gh run view --json jobs` fetches a second page of jobs through repositories/<id>/…, which a proxy may refuse (403): a run whose view
 * fails is read through gh api's repos/{owner}/{repo} paths instead, page by page (M19.55, cp7 F2). `gh(args)` runs gh and parses JSON.
 */
function viaApi(gh) {
  const api = async (path) => gh(['api', `repos/${REPO}/${path}`]);
  const viewed = async (id, fields, fallback) => {
    try {
      return gh(['run', 'view', String(id), '--json', fields]);
    } catch (viewError) {
      try {
        return await fallback();
      } catch (apiError) {
        throw new Error(`${viewError.message}; through gh api: ${apiError.message}`);
      }
    }
  };
  const apiRun = async (id) => {
    const jobs = await pagedJobs(api, id);
    const run = toGhRun(await api(`actions/runs/${id}`), jobs);
    // gh's shape names a job's id databaseId: coldSetup reads its log by it
    return { ...run, jobs: run.jobs.map((j, i) => ({ databaseId: jobs[i].id, ...j })) };
  };
  const apiJobs = async (id) => ({ jobs: (await apiRun(id)).jobs });
  return { viewed, apiRun, apiJobs };
}

/** `gh` reader with the same interface; throws with gh's stderr when a call fails. */
export function ghSource(spawn = spawnSync) {
  const gh = (args) => {
    // a page of 100 runs is several MB of JSON, over spawnSync's 1 MB default (M18.199)
    const r = spawn('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error || r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed (authenticated?): ${(r.stderr || r.error?.message || '').trim()}`);
    return JSON.parse(r.stdout);
  };
  const { viewed, apiRun, apiJobs } = viaApi(gh);
  return {
    view: async (id) => {
      const run = await viewed(id, FIELDS, () => apiRun(id));
      for (const job of run.jobs ?? []) hydrateColdStepTimes(job, id, gh);
      return run;
    },
    list: async (sha) => gh(['run', 'list', '--commit', sha, '--limit', '50', '--json', 'databaseId,workflowName,conclusion']),
    branch: async (name) =>
      gh(['run', 'list', '--branch', name, '--event', 'push', '--limit', '30', '--json', 'databaseId,workflowName,headSha,status,conclusion,createdAt']),
    completed: async (name, file) =>
      gh([
        'run',
        'list',
        '--workflow',
        file,
        '--branch',
        name,
        '--event',
        'push',
        '--status',
        'completed',
        '--limit',
        String(COMPLETED_RUNS),
        '--json',
        RUN_FIELDS,
      ]),
    jobs: async (id) =>
      ((await viewed(id, 'jobs', () => apiJobs(id))).jobs ?? []).map((j) => ({ name: j.name, conclusion: j.conclusion, steps: j.steps ?? null })),
    // gh run list cannot page, so the REST path is read through gh api, as the REST source reads it (M18.199)
    ciPage: async (name, page, size = PAGE_SIZE) => (gh(['api', `repos/${REPO}/${ciPagePath(name, page, size)}`]).workflow_runs ?? []).map(listed),
    coldSetup: async (id) => {
      const job = ((await viewed(id, 'jobs', () => apiJobs(id))).jobs ?? []).find((j) => j.name === 'cold-setup');
      if (!job) return undefined;
      // older gh omits step times: fetch them as view() does, so the duration is known (M18.178)
      try {
        hydrateColdStepTimes(job, id, gh);
      } catch {
        /* no step time: the log may still name the duration (M18.178 r1) */
      }
      const log = spawn('gh', ['api', `repos/${REPO}/actions/jobs/${job.databaseId}/logs`], { encoding: 'utf8', maxBuffer: 1 << 26 });
      const step = (job.steps ?? []).find((s) => s.name === COLD_STEP);
      return { conclusion: job.conclusion, ms: stepMs(step?.startedAt, step?.completedAt), log: log.status === 0 ? log.stdout : null };
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
