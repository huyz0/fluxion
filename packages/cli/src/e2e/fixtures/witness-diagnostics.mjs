// Test-only bounded diagnostics. Helper completion never establishes browser exit.
export function traceTermination(launch, { file, args, options }, trace) {
  Object.assign(trace, { file: String(file), args: [...args], stdout: '', stderr: '' });
  const helper = launch(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  trace.pid = helper.pid;
  for (const stream of ['stdout', 'stderr']) {
    helper[stream]?.on('data', (chunk) => {
      const text = chunk.toString();
      const remaining = 4096 - trace[stream].length;
      trace[stream] += text.slice(0, remaining);
      if (text.length > remaining) trace[`${stream}Truncated`] = true;
    });
  }
  helper.once('error', (error) => {
    trace.error = { code: error.code, message: String(error.message).slice(0, 512) };
  });
  helper.once('exit', (code, signal) => Object.assign(trace, { code, signal }));
  helper.once('close', (closeCode, closeSignal) => Object.assign(trace, { closeCode, closeSignal }));
  return helper;
}
const short = (value, limit) => (value === undefined ? undefined : String(value).slice(0, limit));
export function cleanupSummary(record, primary) {
  const helper = record.termination ?? {};
  return JSON.stringify({
    primary: primary && {
      code: short(primary.code, 32),
      actual: short(primary.actual, 32),
      expected: short(primary.expected, 32),
      message: short(primary.message, 96),
    },
    helper: {
      code: helper.code,
      signal: helper.signal,
      error: short(helper.error?.code ?? helper.error?.message, 64),
      stderr: short(helper.stderr, 160),
      stdout: short(helper.stdout, 80),
    },
    browser: { exitCode: record.child.exitCode, signalCode: record.child.signalCode },
  });
}
