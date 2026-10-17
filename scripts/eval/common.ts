// What the recorded and the scripted runs share (ADR-0039): the system prompt a model gets, the recording key, and the files.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog, CHEAT_SHEET, type EvalCase, evalCaseSchema, formatCatalog, type Recording, recordingSchema } from '@fluxion/dsl';
import { registries } from '../dsl/host-registries.js';

export const ROOT = join(import.meta.dirname, '..', '..');
export const CASES = join(ROOT, 'eval', 'cases');
export const RECORDINGS = join(ROOT, 'eval', 'recordings');
export const OUT = join(ROOT, 'eval', 'out');
/** The model id of the scripted recordings: no model is involved. */
export const SCRIPTED_MODEL = 'scripted-v1';
const TEMPLATE_ID = 'eval-v1';
const TOKENIZER_ID = 'o200k_base';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** `value` as JSON with its keys sorted at every level. */
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sort(x)]),
    );
  };
  return JSON.stringify(sort(value));
}

/** The standing instructions of every request: the cheat sheet and the catalog of this host's registries. */
export function systemPrompt(): string {
  return `${CHEAT_SHEET}\n${formatCatalog(buildCatalog(registries()).catalog, 'llm')}`;
}

/** Hash of what shapes a reply besides the case: the rendered system prompt, the template id and the tokenizer id. */
export function promptHash(system: string): string {
  return sha(`${system}\n${TEMPLATE_ID}\n${TOKENIZER_ID}`);
}

/** The file name (without extension) of the recording of `c` for `model`. */
export function recordingKey(c: EvalCase, system: string, model: string): string {
  return sha(`${canonical(c)}\n${promptHash(system)}\n${model}`);
}

/** Every case in `eval/cases`, in id order; a file that does not match the schema throws. */
export function loadCases(): EvalCase[] {
  if (!existsSync(CASES)) return [];
  return readdirSync(CASES)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => evalCaseSchema.parse(JSON.parse(readFileSync(join(CASES, f), 'utf8'))));
}

/** The recording at `key`, or undefined when there is none. */
export function loadRecording(key: string): Recording | undefined {
  const file = join(RECORDINGS, `${key}.json`);
  return existsSync(file) ? recordingSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : undefined;
}

/** Writes `c` and its recording. */
export function writeCase(c: EvalCase, recording: Recording, system: string): void {
  mkdirSync(CASES, { recursive: true });
  mkdirSync(RECORDINGS, { recursive: true });
  writeFileSync(join(CASES, `${c.id}.json`), `${JSON.stringify(c, null, 2)}\n`);
  writeFileSync(join(RECORDINGS, `${recordingKey(c, system, recording.model)}.json`), `${JSON.stringify(recording, null, 2)}\n`);
}
