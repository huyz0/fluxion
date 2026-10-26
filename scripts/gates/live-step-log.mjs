// Persist decoded subprocess streams before a cancelled supervisor can lose its buffers.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withProcessOutput } from './lib.mjs';

/** Each parallel ladder step owns separate streams; log failures never replace check results. */
export function withLiveStepLog(directory, name, work) {
  let enabled = true;
  const files = Object.fromEntries(['stdout', 'stderr'].map((stream) => [stream, join(directory, `${name}.${stream}.partial.log`)]));
  const warn = () => {
    if (enabled) console.warn(`Live verification output unavailable for ${name}; buffered diagnostics remain enabled.`);
    enabled = false;
  };
  try {
    mkdirSync(directory, { recursive: true });
    for (const file of Object.values(files)) writeFileSync(file, '');
  } catch {
    warn();
  }
  return withProcessOutput((stream, chunk) => {
    if (!enabled) return;
    try {
      appendFileSync(files[stream], chunk);
    } catch {
      warn();
    }
  }, work);
}
