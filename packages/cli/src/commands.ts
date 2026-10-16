// `compile`, `lint`, `layout` and `migrate` (FR-CLI-002, ADR-0036): each reads one file, calls its operation (ops/) and writes its output atomically.

import type { ScreenScore } from '@fluxion/dsl';
import { type Command, internal, type Outcome, usage } from './command.js';
import { hostRegistries } from './host.js';
import { measurerFor } from './measurer.js';
import { compileDocument, layoutDocument, lintDocument, migrateDocument, type OpResult, validateDocument, wrappedMeasure } from './ops/index.js';
import { readInput } from './validate.js';
import { writeText } from './write-file.js';

/** The one file argument of `name`, or the usage outcome. */
function oneFile(name: string, positionals: readonly string[]): string | Outcome {
  const [file, ...extra] = positionals;
  if (file === undefined) return usage(`${name} needs a file`);
  return extra.length > 0 ? usage(`${name} takes one file, got ${positionals.length}`) : file;
}

/** The `-o` value, or the usage outcome. */
function outputOf(name: string, values: Record<string, unknown>): string | Outcome {
  const out = values['out'];
  return typeof out === 'string' && out !== '' ? out : usage(`${name} needs -o <file>`);
}

const failed = (r: OpResult<unknown>): Outcome => ({ exitCode: 1, diagnostics: r.diagnostics });

/** One file-to-file command: what to read, the operation, and what to write and report. */
type Transform<T> = {
  readonly file: string;
  readonly op: (text: string) => OpResult<T>;
  /** The output file and its text; none writes nothing. */
  readonly write?: { readonly output: string; readonly text: (value: T) => string };
  readonly result: (value: T) => unknown;
  /** A summary of the value for the log, after the output is written. */
  readonly summary?: (value: T) => string;
  readonly log: (text: string) => void;
};

/** Reads `file`, runs the operation on its text; with `write` writes the output and returns the reply's result. */
async function transform<T>({ file, op, write, result, summary, log }: Transform<T>): Promise<Outcome> {
  const text = await readInput(file);
  if (typeof text !== 'string') return text;
  const r = op(text);
  if (!r.ok) return failed(r);
  if (write) {
    const bad = await writeText(write.output, write.text(r.value));
    if (bad) return bad;
    log(`${file} -> ${write.output}\n`);
  }
  if (summary) log(summary(r.value));
  return { exitCode: 0, diagnostics: r.diagnostics, result: result(r.value) };
}

/** The core registries of the bundled packs; an internal error when one fails to register. */
function host() {
  const h = hostRegistries();
  return h.problems.length > 0 ? internal(h.problems.map((d) => d.message).join('; ')) : h.registries;
}

/** `compile <file.flux.yaml> -o <out.flux.json>`. */
export const COMPILE: Command = {
  summary: 'Compile FluxScript to a document',
  usage: 'compile <file> -o <out.json>',
  options: { out: { type: 'string', short: 'o' } },
  run: ({ values, positionals }, io) => {
    const file = oneFile('compile', positionals);
    const output = outputOf('compile', values);
    const registries = host();
    if (typeof file !== 'string') return file;
    if (typeof output !== 'string') return output;
    if (!('layouts' in registries)) return registries;
    return transform({
      file,
      op: (text) => compileDocument(text, registries),
      write: { output, text: (v) => v.text },
      result: (v) => ({ out: output, screens: v.screens, records: v.records }),
      log: io.stderr,
    });
  },
};

/** `lint <file> [--min-score N]`. */
export const LINT: Command = {
  summary: 'Score a document against the lint rules',
  usage: 'lint <file> [--min-score <0-100>]',
  options: { 'min-score': { type: 'string' } },
  run: ({ values, positionals }, io) => {
    const file = oneFile('lint', positionals);
    if (typeof file !== 'string') return file;
    const raw = values['min-score'];
    const min = raw === undefined ? undefined : Number(raw);
    if (min !== undefined && !(Number.isFinite(min) && min >= 0 && min <= 100)) return usage('--min-score is a number from 0 to 100');
    const registries = host();
    if (!('layouts' in registries)) return registries;
    return (async () => {
      const text = await readInput(file);
      if (typeof text !== 'string') return text;
      const parsed = validateDocument(text);
      const measure = parsed.ok ? wrappedMeasure(measurerFor(parsed.value.document)) : undefined;
      const r = lintDocument(text, registries, { ...(min === undefined ? {} : { minScore: min }), ...(measure ? { measure } : {}) });
      if (!r.ok) return failed(r);
      io.stderr(`${file}: score ${r.value.score}, ${r.value.findings.length} finding${r.value.findings.length === 1 ? '' : 's'}\n`);
      return { exitCode: 0, diagnostics: r.diagnostics, result: r.value };
    })();
  },
};

/** What the layout operation gives back. */
type Arranged = { readonly text: string; readonly screens: number; readonly scores: readonly ScreenScore[] };

/** The scorecard as a table, one line per screen. */
const scoreTable = (scores: readonly ScreenScore[]): string =>
  scores.map((s) => `${s.screen}: ${s.overlaps} overlaps, ${s.crossings} crossings, ${s.bends} bends, displacement ${s.displacement}px\n`).join('');

/** `layout <file> [-o <out>] [--algorithm name] [--score]`; `-o` is optional only with `--score`, which then writes nothing. */
export const LAYOUT: Command = {
  summary: 'Arrange the screens of a document, or score the arrangement',
  usage: 'layout <file> -o <out.json> [--algorithm <name>] [--score]   (--score alone prints the scorecard and writes nothing)',
  options: { out: { type: 'string', short: 'o' }, algorithm: { type: 'string' }, score: { type: 'boolean' } },
  run: ({ values, positionals }, io) => {
    const file = oneFile('layout', positionals);
    const score = values['score'] === true;
    const output = score && values['out'] === undefined ? undefined : outputOf('layout', values);
    if (typeof file !== 'string') return file;
    if (typeof output === 'object') return output;
    const registries = host();
    if (!('layouts' in registries)) return registries;
    const algorithm = typeof values['algorithm'] === 'string' ? values['algorithm'] : 'layered';
    if (registries.layouts.get(algorithm) === undefined) return usage(`no layout algorithm named "${algorithm}"`);
    return transform<Arranged>({
      file,
      op: (text) => layoutDocument(text, registries, algorithm),
      ...(output === undefined ? {} : { write: { output, text: (v) => v.text } }),
      result: (v) => ({ ...(output === undefined ? {} : { out: output }), algorithm, screens: v.screens, ...(score ? { scores: v.scores } : {}) }),
      ...(score ? { summary: (v) => scoreTable(v.scores) } : {}),
      log: io.stderr,
    });
  },
};

/** `migrate <file> -o <out>`. */
export const MIGRATE: Command = {
  summary: 'Bring a document to the current schema version',
  usage: 'migrate <file> -o <out.json>',
  options: { out: { type: 'string', short: 'o' } },
  run: ({ values, positionals }, io) => {
    const file = oneFile('migrate', positionals);
    const output = outputOf('migrate', values);
    if (typeof file !== 'string') return file;
    if (typeof output !== 'string') return output;
    return transform({
      file,
      op: migrateDocument,
      write: { output, text: (v) => v.text },
      result: (v) => ({ out: output, applied: [...v.applied] }),
      log: io.stderr,
    });
  },
};
