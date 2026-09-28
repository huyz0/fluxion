// `fluxion validate <file>` (FR-CLI-001, ADR-0147): parse and validate a document with the schema
// package, and report every diagnostic with its JSON pointer. Valid (warnings at most): exit 0, the
// warnings are the result; invalid or unreadable: exit 1 with every diagnostic as the errors.
import { readFile } from 'node:fs/promises';
import { parseDocument } from '@fluxion/schema';
import { type Command, io, type Outcome, usage } from './command.js';

/** The text of the document at `file`, or the IO error outcome when it cannot be read. */
export async function readInput(file: string): Promise<string | Outcome> {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    return io(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  }
}

/** The outcome of validating the text of a document. */
export function validateText(text: string): Outcome {
  const r = parseDocument(text);
  if (r.ok) return { exitCode: 0, diagnostics: r.value.diagnostics, result: { diagnostics: r.value.diagnostics } };
  return { exitCode: 1, diagnostics: r.error.diagnostics };
}

/** The `validate` command. */
export const VALIDATE: Command = {
  summary: 'Check a document and list its diagnostics',
  usage: 'validate <file>',
  options: {},
  run: async ({ positionals }, out) => {
    const [file, ...extra] = positionals;
    if (file === undefined) return usage('validate needs a document file');
    if (extra.length > 0) return usage(`validate takes one file, got ${positionals.length}`);
    const text = await readInput(file);
    if (typeof text !== 'string') return text;
    const outcome = validateText(text);
    const errors = outcome.diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = outcome.diagnostics.length - errors;
    out.stderr(
      `${file}: ${errors === 0 ? 'valid' : `${errors} error${errors === 1 ? '' : 's'}`}${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}\n`,
    );
    return outcome;
  },
};
