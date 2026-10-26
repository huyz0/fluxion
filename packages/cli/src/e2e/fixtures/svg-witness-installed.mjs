// Copy beside requests.json/font.woff2 in an isolated installed consumer; run with node --test.
// Native paint/exit evidence is separate from the explicitly held-reply fault-injection test.
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanupSummary, traceTermination } from './witness-diagnostics.mjs';

const { createNodeSvgPaintWitness } = await import(process.env.FLUXION_WITNESS_MODULE ?? '@fluxion/cli/svg-witness');
const { LIGHT_THEME } = await import(process.env.FLUXION_WITNESS_THEME_MODULE ?? '@fluxion/theme');
const peerModule = process.env.FLUXION_WITNESS_PLAYWRIGHT_MODULE ?? import.meta.resolve('playwright');
const playwright = await import(peerModule);
const playwrightVersion = JSON.parse(await readFile(new URL('./package.json', peerModule), 'utf8')).version;

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
let failedTerminations = 0;
const nativeSpawn = childProcess.spawn;
function mark(record, event) {
  if (record.events.length < 24) record.events.push({ event, ms: Math.round(performance.now() - record.started) });
}
childProcess.spawn = function (file, args, ...rest) {
  const record = owned.find(
    (r) => win32.basename(String(file)).toLowerCase() === 'taskkill.exe' && JSON.stringify(args) === JSON.stringify(['/PID', String(r.child.pid), '/T', '/F']),
  );
  if (record) {
    mark(record, 'taskkill-start');
    if (mode === 'fail-termination') {
      failedTerminations++;
      throw Error('injected owned termination failure');
    }
  }
  if (record) record.termination = {};
  const helper = record
    ? traceTermination(nativeSpawn.bind(this), { file, args, options: rest[0] }, record.termination)
    : nativeSpawn.call(this, file, args, ...rest);
  if (record) {
    mark(record, 'taskkill-return');
    helper.once('exit', () => mark(record, 'taskkill-exit'));
    helper.once('error', () => mark(record, 'taskkill-error'));
  }
  return helper;
};
syncBuiltinESMExports();
function watchServer(server) {
  const record = { server, child: server.process(), blocked: [], started: performance.now(), events: [] };
  owned.push(record);
  record.child.once('exit', () => mark(record, 'browser-exit'));
  record.child.once('close', () => mark(record, 'browser-close'));
  for (const method of ['close', 'kill']) {
    const original = server[method];
    server[method] = function (...args) {
      mark(record, `${method}-start`);
      const result = original.apply(this, args);
      mark(record, `${method}-return`);
      result.then(
        () => mark(record, `${method}-settled`),
        () => mark(record, `${method}-rejected`),
      );
      return result;
    };
  }
}
async function disposeChecked(session, record, primary) {
  let failure;
  mark(record, 'dispose-start');
  try {
    const result = await session.dispose();
    mark(record, 'dispose-finished');
    const trace = {
      platform: process.platform,
      node: process.version,
      playwright: playwrightVersion,
      engine,
      pid: record.child.pid,
      exitCode: record.child.exitCode,
      signalCode: record.child.signalCode,
      termination: record.termination,
      events: record.events,
    };
    console.log(`WITNESS_CLEANUP ${JSON.stringify(trace)}`);
    assert.equal(result.ok, true, cleanupSummary(record, primary));
    exited(record);
  } catch (error) {
    failure = error;
  }
  if (primary && failure) throw new AggregateError([primary, failure], cleanupSummary(record, primary));
  if (primary) throw primary;
  if (failure) throw failure;
}
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
  native.then(watchServer, () => {});
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
  childProcess.spawn = nativeSpawn;
  syncBuiltinESMExports();
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
  let primary;
  try {
    for (const { request } of samples) {
      assert.deepEqual(await session.observe(request), {
        ok: true,
        value: { identity: request.identity, status: 'painted', fontHashes: request.fonts.map((f) => f.sha256) },
      });
    }
    assert.deepEqual(record.blocked, []);
  } catch (error) {
    primary = error;
  } finally {
    await disposeChecked(session, record, primary);
  }
  exited(record);
});
test(`NFR-SEC-001: installed ${engine} context aborts network requests before dispatch`, settings, async () => {
  const session = await create();
  const record = owned.at(-1);
  let primary;
  try {
    await assert.rejects(record.context.pages()[0].goto('https://fluxion-network.invalid/probe', { timeout: 10000 }));
    assert.deepEqual(record.blocked, ['https://fluxion-network.invalid/probe']);
  } catch (error) {
    primary = error;
  } finally {
    await disposeChecked(session, record, primary);
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
  let primary;
  try {
    const pending = session.observe(samples[0].request);
    await started;
    abort.abort();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'cancelled');
  } catch (error) {
    primary = error;
  } finally {
    mode = 'normal';
    await disposeChecked(session, record, primary);
  }
  exited(record);
});
test(`NFR-SEC-001: installed ${engine} deadline rejects an explicitly held native reply and closes its process`, settings, async () => {
  const session = await create();
  const record = owned.at(-1);
  mode = 'hold-reply';
  let primary;
  try {
    const result = await session.observe(samples[0].request);
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'deadline');
    releaseReply();
  } catch (error) {
    primary = error;
  } finally {
    mode = 'normal';
    await disposeChecked(session, record, primary);
  }
  exited(record);
});
test(`NFR-SEC-001: installed ${engine} reports cleanup failure when injected owned termination failures prevent exit`, settings, async () => {
  const session = await create();
  const record = owned.at(-1);
  const close = record.server.close,
    kill = record.server.kill;
  record.server.close = () => new Promise(() => {});
  mode = 'fail-termination';
  const before = failedTerminations;
  record.server.kill = async () => {
    throw Error('injected kill failure');
  };
  try {
    const result = await session.dispose();
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'cleanup');
    if (process.platform === 'win32') {
      assert.equal(failedTerminations - before, 1, 'installed Windows adapter must reach the exact owned spawn');
      assert.equal(record.child.exitCode, null);
      assert.equal(record.child.signalCode, null);
    }
  } finally {
    mode = 'normal';
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
  let primary;
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
  } catch (error) {
    primary = error;
  } finally {
    await disposeChecked(session, record, primary);
  }
});
