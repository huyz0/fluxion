import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Retain complete diagnostic blocks, including unrecognized output; normalize paths and order only. */
export function diagnosticLines(output, root) {
  const normalized = output.replaceAll('\r\n', '\n').replaceAll(root, '<source>').replaceAll(root.replaceAll('\\', '/'), '<source>');
  const blocks = [];
  for (const raw of normalized.split('\n')) {
    const line = raw.replace(/^(.+?)(\(\d+,\d+\): (?:error|warning) TS\d+:)/, (_, path, suffix) => path.replaceAll('\\', '/') + suffix);
    if (!line.trim()) continue;
    if (/^\s/.test(line) && blocks.length) blocks[blocks.length - 1] += `\n${line}`;
    else blocks.push(line);
  }
  return blocks.sort();
}

/** All compiler outputs, including maps and JavaScript. Build-info caches contain compiler-specific state. */
export function emittedFiles(root, directories) {
  const result = {};
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (!entry.name.endsWith('.tsbuildinfo'))
        result[relative(root, path).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  for (const dir of directories) visit(join(root, dir, '.tsbuild'));
  return result;
}

export function compareResults(left, right) {
  const errors = [];
  if (left.status !== right.status) errors.push(`exit status differs: ${left.status} / ${right.status}`);
  if (JSON.stringify(left.diagnostics) !== JSON.stringify(right.diagnostics)) errors.push('diagnostic blocks differ');
  for (const name of new Set([...Object.keys(left.files), ...Object.keys(right.files)])) {
    if (!(name in left.files)) errors.push(`tsrs-only output: ${name}`);
    else if (!(name in right.files)) errors.push(`TS7-only output: ${name}`);
    else if (left.files[name] !== right.files[name]) errors.push(`different output: ${name}`);
  }
  return errors;
}

/** A matching compiler crash or unrelated failure must never qualify a deliberate-error probe. */
export function resultProblems(result, expectedFailure, probe = null) {
  const errors = [];
  const failure = result.status !== null && result.status !== 0 && result.diagnostics.length > 0;
  const success = result.status === 0 && result.diagnostics.length === 0;
  if (!(expectedFailure ? failure : success)) errors.push('unexpected compiler result');
  if (!Object.keys(result.files).length) errors.push('no emitted inventory');
  if (probe)
    for (const code of ['TS2322', 'TS2375', 'TS2307']) {
      if (!result.diagnostics.some((block) => block.startsWith(probe) && block.includes(`error ${code}:`))) errors.push(`missing intended ${code} probe`);
    }
  return errors;
}
