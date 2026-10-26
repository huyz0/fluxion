// Keep actionable failure headings in the ladder and complete streams in an artifact.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { repoPath } from './lib.mjs';

const TAP_FIELD = /^\s*(?:location|failureType|error|code|expected|actual|operator|stack):/;
function tapField(lines, index) {
  const indent = lines[index].search(/\S/);
  const parts = [lines[index]];
  for (let next = index + 1; next < Math.min(index + 5, lines.length) && lines[next].search(/\S/) > indent; next++) parts.push(lines[next]);
  const text = parts.join('\n');
  return text.length > 750 ? `${text.slice(0, 750)} [field excerpt; see full log]` : text;
}
function tapBoundary(line, headingIndent) {
  const indent = line.search(/\S/);
  const text = line.trim();
  return (indent === headingIndent + 2 && text === '...') || (indent <= headingIndent && /^(?:not )?ok \d+\b|^# Subtest:/.test(text));
}
function tapFailure(lines, start) {
  let end = start + 1;
  while (end < lines.length && !tapBoundary(lines[end], lines[start].search(/\S/))) end++;

  const block = lines.slice(start + 1, end);
  return [lines[start], ...block.flatMap((line, index) => (TAP_FIELD.test(line) ? [tapField(block, index)] : []))];
}

export function failureLines(stdout, stderr) {
  const all = stripVTControlCharacters(`${stdout}\n${stderr}`).trim().split(/\r?\n/);
  const failing = all.findIndex((line) => line.startsWith('✖ failing tests:'));
  const tail = failing >= 0 ? all.slice(failing, failing + 40) : all.slice(-40);
  const headings = all.flatMap((line, i) => (/^\s*FAIL\s/.test(line) ? all.slice(i, i + 3) : []));
  const replay = all.filter((line) => /Property failed after|Counterexample:|\{ seed: -?\d+/.test(line) && !tail.includes(line)).slice(0, 6);
  // Nested node:test output can sit inside a Vitest assertion, far before the
  // passing tail. Retain every failing subtest's diagnostic fields first.
  const tap = all.flatMap((line, index) => (/^\s*not ok \d+\b/.test(line) ? [tapFailure(all, index).join('\n')] : []));
  return [...replay, ...tap, ...headings, ...tail.filter((line) => !headings.includes(line))];
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

function annotationBodies(details) {
  const bodies = [];
  let body = '';
  for (const detail of details) {
    const clean = stripVTControlCharacters(detail);
    // Leave room for a preceding failure heading in the same annotation.
    const excerpt = clean.length > 12000 ? `${clean.slice(0, 11950)}\n[excerpt truncated]` : clean;
    if (body && body.length + excerpt.length + 1 > 14000) {
      bodies.push(body);
      body = '';
    }
    body += `${body ? '\n' : ''}${excerpt}`;
  }
  if (body || !bodies.length) bodies.push(body);
  return bodies;
}

/** Each bounded command preserves complete-log access; failing input cannot inject commands. */
export function failureAnnotation(name, details, log) {
  return annotationBodies(details)
    .map((body) => {
      const text = `Verification failed: ${name}\n${body}${log ? `\nFull failure output: ${log}` : ''}`;
      return `::error::${text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`;
    })
    .join('\n');
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
