import { type Diagnostic, qualifiedNameSchema } from '@fluxion/schema';
import { namesProblem } from './paths.js';
import { sha256Hex } from './sha256.js';
import type { SvgBatchFile, SvgBatchInput, SvgBatchOptions, SvgBatchOutcome, SvgBatchReport } from './svg-batch-types.js';
import { importSvgShape } from './svg-import.js';
import { decodeUtf8Strict } from './utf8.js';
import { readZip } from './zip.js';

export type { SvgBatchFile, SvgBatchInput, SvgBatchOptions, SvgBatchOutcome, SvgBatchReport } from './svg-batch-types.js';

const ENTRY_LIMIT = 128 * 1024 * 1024;
const TOTAL_LIMIT = 256 * 1024 * 1024;
const SVG_BYTES = 8 * 1024 * 1024;
const SVG_CHARS = 2 * 1024 * 1024;
const isSvg = (path: string) => /\.svg$/i.test(path);
const problem = (message: string): Diagnostic => ({ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message });
const failure = (message: string, files?: readonly SvgBatchFile[]): SvgBatchReport => ({
  status: 'preflight-failed',
  enumerationComplete: files !== undefined,
  diagnostics: [problem(message)],
  inputs: files?.filter((f) => !f.path.endsWith('/')).map((f) => ({ path: f.path, status: 'not-attempted' as const })) ?? [],
});
function bounds(files: readonly SvgBatchFile[]): string | undefined {
  if (files.length > 4096) return 'more than 4096 entries';
  let total = 0;
  for (const f of files) {
    if (typeof f.path !== 'string' || !(f.bytes instanceof Uint8Array)) return 'invalid named input';
    if (f.bytes.byteLength > ENTRY_LIMIT) return 'entry exceeds 128 MiB';
    total += f.bytes.byteLength;
    if (total > TOTAL_LIMIT) return 'inputs exceed 256 MiB';
    if (f.path.endsWith('/') && f.bytes.byteLength !== 0) return 'directory entry contains bytes';
  }
  return namesProblem(files.map((f) => f.path));
}
function mapping(files: readonly SvgBatchFile[], ids: Readonly<Record<string, string>>): string | undefined {
  const paths = files.filter((f) => !f.path.endsWith('/') && isSvg(f.path)).map((f) => f.path);
  if (!paths.length) return 'no SVG inputs selected';
  if (Object.keys(ids).length !== paths.length || paths.some((p) => !Object.hasOwn(ids, p))) return 'ID map must cover exactly the selected SVG paths';
  const values = paths.map((p) => ids[p]);
  if (values.some((id) => !qualifiedNameSchema.safeParse(id).success)) return 'invalid qualified definition ID';
  return new Set(values).size !== values.length ? 'duplicate target definition IDs' : undefined;
}
function snapshot(options: SvgBatchOptions): SvgBatchOptions {
  return {
    ids: { ...options.ids },
    witness: options.witness,
    ...(options.colors === undefined ? {} : { colors: { ...options.colors } }),
    ...(options.tokenRefs === undefined ? {} : { tokenRefs: new Set(options.tokenRefs) }),
    ...(options.fonts === undefined ? {} : { fonts: options.fonts.map((f) => ({ ...f })) }),
    ...(options.defaultFont === undefined ? {} : { defaultFont: options.defaultFont }),
  };
}
async function convert(file: SvgBatchFile, options: SvgBatchOptions): Promise<SvgBatchOutcome> {
  const base = { path: file.path, sourceSha256: sha256Hex(file.bytes) };
  const refused = (message: string): SvgBatchOutcome => ({ ...base, status: 'refused', diagnostics: [problem(message)] });
  if (!isSvg(file.path)) return refused('unsupported regular member: expected SVG');
  if (file.bytes.byteLength > SVG_BYTES) return refused('encoded SVG exceeds 8 MiB');
  const text = decodeUtf8Strict(file.bytes);
  if (text === undefined) return refused('SVG is not valid UTF8');
  if (text.length > SVG_CHARS) return refused('SVG exceeds 2 Mi characters');
  const result = await importSvgShape(text, { ...options, id: options.ids[file.path] as string });
  return result.ok ? { ...base, status: 'accepted', value: result.value } : { ...base, status: 'refused', diagnostics: result.error };
}
function enumerate(input: SvgBatchInput): readonly SvgBatchFile[] | string {
  if (input.kind === 'files' && Array.isArray(input.files)) return input.files;
  if (input.kind !== 'zip') return 'invalid batch input'; // kind-switch-allow: closed input transport union, not an extensible element kind
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > TOTAL_LIMIT) return 'ZIP input exceeds 256 MiB or is invalid';
  const zip = readZip(input.bytes, { maxEntries: 4096, maxEntryBytes: ENTRY_LIMIT, maxTotalBytes: TOTAL_LIMIT, strictNames: true });
  return zip.ok ? zip.value.map((e) => ({ path: e.name, bytes: e.bytes })) : zip.error.reason;
}
/**
 * Preflight a bounded input set before sequential SVG conversion. Retains every regular member,
 * source identity and font obligation. This pure report does not authorize pack distribution.
 * @public
 */
export async function importSvgBatch(input: SvgBatchInput, options: SvgBatchOptions): Promise<SvgBatchReport> {
  let files: readonly SvgBatchFile[];
  let context: SvgBatchOptions;
  try {
    const entries = enumerate(input);
    if (typeof entries === 'string') return failure(entries);
    files = entries;
    // Validate runtime structure before building even a failure's enumerated-path list.
    if (files.some((f) => !f || typeof f.path !== 'string' || !(f.bytes instanceof Uint8Array))) return failure('invalid named input');
    const issue = bounds(files);
    if (issue) return failure(issue, files);
    context = snapshot(options);
    const idIssue = mapping(files, context.ids);
    if (idIssue) return failure(idIssue, files);
    files = files.filter((f) => !f.path.endsWith('/')).map((f) => ({ path: f.path, bytes: new Uint8Array(f.bytes) }));
  } catch {
    return failure('invalid input structure or host allocation failure');
  }
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const inputs: SvgBatchOutcome[] = [];
  for (const file of sorted) inputs.push(await convert(file, context));
  return {
    status: 'processed',
    inputCount: inputs.length,
    svgCount: files.filter((f) => isSvg(f.path)).length,
    acceptedCount: inputs.filter((r) => r.status === 'accepted').length,
    inputs,
  };
}
