// Copy beside requests.json/font.woff2 in an isolated installed consumer; run with node --test.
// Native paint/exit evidence is separate from the explicitly held-reply fault-injection test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const { createNodeSvgPaintWitness } = await import(process.env.FLUXION_WITNESS_MODULE ?? '@fluxion/cli/svg-witness');
const { LIGHT_THEME } = await import(process.env.FLUXION_WITNESS_THEME_MODULE ?? '@fluxion/theme');
const playwright = await import(process.env.FLUXION_WITNESS_PLAYWRIGHT_MODULE ?? 'playwright');

const engine = process.env.FLUXION_WITNESS_ENGINE ?? 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
const driver = playwright[engine];
const samples = JSON.parse(await readFile(new URL('./requests.json', import.meta.url), 'utf8'));
const bytes = new Uint8Array(await readFile(new URL('./font.woff2', import.meta.url)));
const faces = samples.flatMap((s) => s.request.fonts).filter((f, i, all) => all.findIndex((other) => other.family === f.family) === i);
const options = { browser: engine, theme: LIGHT_THEME, fonts: faces.map((f) => ({ ...f, bytes, profile: 'inter-latin-400-ascii' })) };
const owned = [];
let mode = 'normal';
let observationStarted = () => {};
let releaseReply = () => {};
const launch = driver.launchServer;
const connect = driver.connect;
function watchPage(page) {
  const evaluate = page.evaluate;
  let calls = 0;
  page.evaluate = function (...args) {
    const native = evaluate.apply(this, args);
    calls++;
    if (calls !== 3 || mode === 'normal') return native;
    observationStarted();
    if (mode !== 'hold-reply') return native;
    return new Promise((resolve, reject) => {
      native.then((value) => {
        releaseReply = () => resolve(value);
      }, reject);
    });
  };
}
function watchContext(context, record) {
  record.context = context;
  const route = context.route;
  context.route = function (pattern, handler) {
    return route.call(this, pattern, (request) => {
      const abort = request.abort;
      request.abort = function (...args) {
        record.blocked.push(request.request().url());
        return abort.apply(this, args);
      };
      return handler(request);
    });
  };
  const newPage = context.newPage;
  context.newPage = function (...args) {
    const native = newPage.apply(this, args);
    native.then(watchPage, () => {});
    return native;
  };
}
driver.launchServer = function (...args) {
  const native = launch.apply(this, args);
  native.then(
    (server) => owned.push({ server, child: server.process(), blocked: [] }),
    () => {},
  );
  return native;
};
driver.connect = function (endpoint, ...args) {
  const native = connect.call(this, endpoint, ...args);
  native.then(
    (browser) => {
      const record = owned.find((r) => r.server.wsEndpoint() === endpoint);
      assert.ok(record);
      const newContext = browser.newContext;
      browser.newContext = function (...contextArgs) {
        const result = newContext.apply(this, contextArgs);
        result.then(
          (context) => watchContext(context, record),
          () => {},
        );
        return result;
      };
    },
    () => {},
  );
  return native;
};
after(async () => {
  driver.launchServer = launch;
  driver.connect = connect;
  for (const record of owned) {
    if (record.child.exitCode === null && record.child.signalCode === null) await record.server.kill();
  }
});
function exited(record) {
  assert.ok(record.child.exitCode !== null || record.child.signalCode !== null, 'owned process must have exited');
}
async function create(signal) {
  const made = await createNodeSvgPaintWitness({ ...options, ...(signal ? { signal } : {}) });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.value;
}
const settings = { timeout: 40000 };
test(`FR-LIB-004: installed ${engine} witness paints canonical fixtures and observes owned-process exit`, settings, async () => {
  const session = await create();
  const record = owned.at(-1);
  try {
    for (const { request } of samples) {
      assert.deepEqual(await session.observe(request), {
        ok: true,
        value: { identity: request.identity, status: 'painted', fontHashes: request.fonts.map((f) => f.sha256) },
      });
    }
    assert.deepEqual(record.blocked, []);
  } finally {
    assert.equal((await session.dispose()).ok, true);
  }
  exited(record);
});
test(`NFR-SEC-001: installed ${engine} context aborts network requests before dispatch`, settings, async () => {
  const session = await create();
  const record = owned.at(-1);
  try {
    await assert.rejects(record.context.pages()[0].goto('https://fluxion-network.invalid/probe', { timeout: 10000 }));
    assert.deepEqual(record.blocked, ['https://fluxion-network.invalid/probe']);
  } finally {
    assert.equal((await session.dispose()).ok, true);
  }
  exited(record);
});
test(`NFR-SEC-001: installed ${engine} abort cancels a started native observation and closes its process`, settings, async () => {
  const abort = new AbortController();
  const session = await create(abort.signal);
  const record = owned.at(-1);
  const started = new Promise((resolve) => {
    observationStarted = resolve;
  });
  mode = 'observe-started';
  try {
    const pending = session.observe(samples[0].request);
    await started;
    abort.abort();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'cancelled');
  } finally {
    mode = 'normal';
    assert.equal((await session.dispose()).ok, true);
  }
  exited(record);
});
test(`NFR-SEC-001: installed ${engine} deadline rejects an explicitly held native reply and closes its process`, settings, async () => {
  const session = await create();
  const record = owned.at(-1);
  mode = 'hold-reply';
  try {
    const result = await session.observe(samples[0].request);
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'deadline');
    releaseReply();
  } finally {
    mode = 'normal';
    assert.equal((await session.dispose()).ok, true);
  }
  exited(record);
});
test(`NFR-SEC-001: installed ${engine} reports cleanup failure when injected close/kill failures prevent exit`, settings, async () => {
  const session = await create();
  const record = owned.at(-1);
  const close = record.server.close,
    kill = record.server.kill;
  record.server.close = () => new Promise(() => {});
  record.server.kill = async () => {
    throw Error('injected kill failure');
  };
  try {
    const result = await session.dispose();
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'cleanup');
  } finally {
    record.server.close = close;
    record.server.kill = kill;
    const exit = record.child.exitCode === null && record.child.signalCode === null ? once(record.child, 'exit') : Promise.resolve();
    await record.server.kill();
    await exit;
  }
  exited(record);
});
test(`FR-LIB-004: installed ${engine} missing executable reports peer-missing without fallback`, settings, async () => {
  const empty = await mkdtemp(join(tmpdir(), 'fluxion-witness-no-browser-'));
  try {
    const code =
      "const {createNodeSvgPaintWitness}=await import(process.env.FLUXION_WITNESS_MODULE??'@fluxion/cli/svg-witness'); const r=await createNodeSvgPaintWitness({theme:{name:'plain',tokens:{}},fonts:[],browser:process.env.FLUXION_WITNESS_ENGINE??'chromium'}); console.log(JSON.stringify(r)); if(r.ok)await r.value.dispose();";
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: fileURLToPath(new URL('./', import.meta.url)),
      encoding: 'utf8',
      timeout: 25000,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty },
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'peer-missing');
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
test(`NFR-SEC-001: installed ${engine} admits 128 observations then closes without a 129th browser call`, { timeout: 125000 }, async () => {
  const session = await create();
  const record = owned.at(-1);
  try {
    for (let i = 0; i < 128; i++) {
      const result = await session.observe(samples[0].request);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.value.status, 'painted');
    }
    exited(record);
    const refused = await session.observe(samples[0].request);
    assert.equal(refused.ok, false);
    assert.equal(refused.error.kind, 'disposed');
  } finally {
    assert.equal((await session.dispose()).ok, true);
  }
});
