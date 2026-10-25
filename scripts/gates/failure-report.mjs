// Keep actionable failure headings in the ladder and complete streams in an artifact.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { repoPath } from './lib.mjs';

export function failureLines(stdout, stderr) {
  const all = stripVTControlCharacters(`${stdout}\n${stderr}`).trim().split(/\r?\n/);
  const failing = all.findIndex((line) => line.startsWith('✖ failing tests:'));
  const tail = failing >= 0 ? all.slice(failing, failing + 40) : all.slice(-40);
  const headings = all.flatMap((line, i) => (/^\s*FAIL\s/.test(line) ? all.slice(i, i + 3) : []));
  const replay = all.filter((line) => /Property failed after|Counterexample:|\{ seed: -?\d+/.test(line) && !tail.includes(line)).slice(0, 6);
  return [...replay, ...headings, ...tail.filter((line) => !headings.includes(line))];
}

export function writeFailureLog(name, { stdout, stderr }, runId) {
  const relative = `.harness/tmp/verify-logs/${runId}/${name}.log`;
  try {
    const file = repoPath(relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
    return relative;
  } catch (error) {
    // A full disk must not discard the original failure or the other steps' results.
    return `unavailable (${error.message})`;
  }
}
