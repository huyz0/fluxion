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

/** GitHub command data is escaped so a failing test cannot emit another workflow command. */
export function failureAnnotation(name, details, log) {
  const body = stripVTControlCharacters(details.join('\n'));
  const excerpt = body.length > 16000 ? `${body.slice(0, 16000)}\n[excerpt truncated]` : body;
  const text = `Verification failed: ${name}\n${excerpt}${log ? `\nFull failure output: ${log}` : ''}`;
  return `::error::${text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`;
}

/** Successful gates may still report target overruns; never hide them behind a PASS line. */
export function advisoryLines(stdout) {
  return stripVTControlCharacters(stdout)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('ADVISORY '));
}

/** Escape advisory data just like errors so it cannot inject a workflow command. */
export function advisoryAnnotation(name, details) {
  const text = `Advisory target exceeded: ${name}\n${details.join('\n')}`.slice(0, 16000);
  return `::warning::${text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`;
}
