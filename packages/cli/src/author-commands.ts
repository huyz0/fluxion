// `patch`, `decompile` and `catalog` (FR-CLI-002, ADR-0036): the authoring loop over the ops layer.
import { type Command, internal, type Outcome, unsupported, usage } from './command.js';
import { hostRegistries } from './host.js';
import { catalogText, decompileText, patchText } from './ops/index.js';
import { readInput } from './validate.js';
import { writeText } from './write-file.js';

const FORMATS = ['llm', 'json', 'md'] as const;

/** The core registries of the bundled packs, or the internal error when one fails to register. */
function host() {
  const h = hostRegistries();
  return h.problems.length > 0 ? internal(h.problems.map((d) => d.message).join('; ')) : h.registries;
}

const outputOf = (name: string, values: Record<string, unknown>): string | Outcome =>
  typeof values['out'] === 'string' && values['out'] !== '' ? values['out'] : usage(`${name} needs -o <file>`);

/** `patch <document> <patch.json> -o <out>`. */
export const PATCH: Command = {
  summary: 'Apply an AI patch to a document',
  usage: 'patch <document> <patch.json> -o <out.json>',
  options: { out: { type: 'string', short: 'o' } },
  run: async ({ values, positionals }, io) => {
    const [file, patchFile, ...extra] = positionals;
    if (file === undefined || patchFile === undefined) return usage('patch needs <document> and <patch.json>');
    if (extra.length > 0) return usage(`patch takes two files, got ${positionals.length}`);
    const output = outputOf('patch', values);
    if (typeof output !== 'string') return output;
    const registries = host();
    if (!('layouts' in registries)) return registries;
    const [text, patch] = [await readInput(file), await readInput(patchFile)];
    if (typeof text !== 'string') return text;
    if (typeof patch !== 'string') return patch;
    const r = patchText(text, patch, registries);
    if (!r.ok) return { exitCode: 1, diagnostics: r.diagnostics };
    const bad = await writeText(output, r.value.text);
    if (bad) return bad;
    io.stderr(`${file} -> ${output}: ${r.value.applied.ops} op${r.value.applied.ops === 1 ? '' : 's'}, ${r.value.applied.changed} records\n`);
    return { exitCode: 0, diagnostics: r.diagnostics, result: { out: output, ...r.value.applied } };
  },
};

/** `decompile <document> -o <out.flux.yaml>`. */
export const DECOMPILE: Command = {
  summary: 'Write a document as FluxScript',
  usage: 'decompile <document> -o <out.flux.yaml>',
  options: { out: { type: 'string', short: 'o' } },
  run: async ({ values, positionals }, io) => {
    const [file, ...extra] = positionals;
    if (file === undefined) return usage('decompile needs a document file');
    if (extra.length > 0) return usage(`decompile takes one file, got ${positionals.length}`);
    const output = outputOf('decompile', values);
    if (typeof output !== 'string') return output;
    const registries = host();
    if (!('layouts' in registries)) return registries;
    const text = await readInput(file);
    if (typeof text !== 'string') return text;
    const r = decompileText(text, registries);
    if (!r.ok) return { exitCode: 1, diagnostics: r.diagnostics };
    const bad = await writeText(output, r.value.text);
    if (bad) return bad;
    io.stderr(`${file} -> ${output}: ${r.value.kept} kept record${r.value.kept === 1 ? '' : 's'} not written\n`);
    return { exitCode: 0, diagnostics: r.diagnostics, result: { out: output, kept: r.value.kept } };
  },
};

/** `catalog [--format llm|json|md] [-o file]`. */
export const CATALOG: Command = {
  summary: 'List the shapes, layouts and markers the host can draw',
  usage: 'catalog [--format llm|json|md] [-o <file>]',
  options: { format: { type: 'string' }, out: { type: 'string', short: 'o' } },
  run: async ({ values, positionals }, io) => {
    if (positionals.length > 0) return usage(`catalog takes no file, got ${positionals.length}`);
    const format = values['format'] ?? 'llm';
    if (!FORMATS.some((f) => f === format)) return unsupported(`--format is ${FORMATS.join(', ')}; got "${String(format)}"`);
    const registries = host();
    if (!('layouts' in registries)) return registries;
    const r = catalogText(registries, format as (typeof FORMATS)[number]);
    if (!r.ok) return { exitCode: 1, diagnostics: r.diagnostics };
    const out = values['out'];
    if (typeof out === 'string' && out !== '') {
      const bad = await writeText(out, r.value.text);
      if (bad) return bad;
      return { exitCode: 0, diagnostics: r.diagnostics, result: { format, out, bytes: r.value.text.length } };
    }
    // without -o the catalog is the output: on stdout for people, in the reply for --json (stdout carries the reply alone)
    if (values['json'] !== true) io.stdout(r.value.text);
    return {
      exitCode: 0,
      diagnostics: r.diagnostics,
      result: { format, bytes: r.value.text.length, ...(values['json'] === true ? { text: r.value.text } : {}) },
    };
  },
};
