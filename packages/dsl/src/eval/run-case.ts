// Runs one eval case against a recording (ADR-0039, FR-AI-009): the real compiler, patcher and linter run on the recorded replies, so what is
// measured is the harness and the pipeline, and a regression in either shows as a number.
import type { CoreRegistries } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';
import { compile } from '../compile.js';
import { decompile } from '../decompile/decompile.js';
import { formatDiagnostics } from '../diagnostics/format.js';
import { type AbortSignalLike, LlmError } from '../generate/llm.js';
import { generateDeck, MAX_REPAIRS, unfence } from '../generate/orchestrate.js';
import { lint } from '../lint/lint.js';
import { needsAlt } from '../lint/rules-a11y.js';
import type { LintRegistry } from '../lint/types.js';
import { patchDocument } from '../patch/apply-document.js';
import type { EvalCase, Recording } from './case.js';
import { replayClient } from './replay.js';

/**
 * What a case run needs besides the case.
 *
 * @public
 */
export type CaseDeps = {
  /** Registries for compile and patch. */
  readonly registries: CoreRegistries;
  /** The standing instructions the model got. */
  readonly system: string;
  /** Lint rules. */
  readonly lintRegistry: LintRegistry;
  /** The recorded replies; absent when there is no recording (the case then fails as `recording-missing`). */
  readonly recording?: Recording | undefined;
  /** Counts tokens of a text; the token ratio is left out when omitted. */
  readonly countTokens?: ((text: string) => number) | undefined;
};

/**
 * How one case went.
 *
 * @public
 */
export type CaseResult = {
  /** The case id. */
  readonly id: string;
  /** The case mode. */
  readonly mode: EvalCase['mode'];
  /** Attempts until the result was valid (1 = first try), or null when it never was. */
  readonly attempts: number | null;
  /** True when the result is valid and meets the expectations. */
  readonly pass: boolean;
  /** What failed, in words. */
  readonly failures: readonly string[];
  /** The lint score of the result, when there is one. */
  readonly lint: number | null;
  /** Share of image, icon and role-group elements with a name, 0 to 100; null when there are none. */
  readonly altCoveragePct: number | null;
  /** JSON tokens over FluxScript tokens of the result (generate mode, when tokens are counted). */
  readonly dslTokenRatio: number | null;
  /** Tokens read. */
  readonly tokensIn: number;
  /** Tokens written. */
  readonly tokensOut: number;
};

const NEVER: AbortSignalLike = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined };
const ATTEMPTS = MAX_REPAIRS + 1;
const EDIT_ASK = 'Reply with the AI patch as JSON only, no prose.';
const REPAIR_ASK = 'Reply with the corrected complete FluxScript file only, no prose.';

type Outcome = { doc: DocumentFile | undefined; attempts: number | null; tokensIn: number; tokensOut: number };

/** Asks until `check` accepts the reply or the attempts are used; `check` gives the document or the problems to send back. */
async function converse(
  deps: CaseDeps,
  first: string,
  replay: ReturnType<typeof replayClient>,
  check: (reply: string) => { doc: DocumentFile } | { problems: readonly string[] },
): Promise<Outcome> {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: first }];
  const usage = { tokensIn: 0, tokensOut: 0 };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let reply = '';
    for await (const c of replay.client.stream({ system: deps.system, messages }, NEVER)) {
      if (c.type === 'text') reply += c.text;
      else if (c.type === 'usage') {
        usage.tokensIn += c.tokensIn;
        usage.tokensOut += c.tokensOut;
      }
    }
    const r = check(reply);
    if ('doc' in r) return { doc: r.doc, attempts: attempt, ...usage };
    messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `Problems:\n${r.problems.join('\n')}\n\nTry again.` });
  }
  return { doc: undefined, attempts: null, ...usage };
}

const errorLines = (ds: Parameters<typeof formatDiagnostics>[0]) => formatDiagnostics(ds.filter((d) => d.severity === 'error'));

async function runEdit(c: EvalCase, deps: CaseDeps, replay: ReturnType<typeof replayClient>): Promise<Outcome> {
  const start = compile(c.inputs?.document ?? '', { registries: deps.registries }).doc;
  if (!start) return { doc: undefined, attempts: null, tokensIn: 0, tokensOut: 0 };
  return converse(deps, `${c.prompt}\n\nThe document:\n${c.inputs?.document}\n\n${EDIT_ASK}`, replay, (reply) => {
    let patch: unknown;
    try {
      patch = JSON.parse(unfence(reply));
    } catch {
      return { problems: ['the reply is not JSON'] };
    }
    const r = patchDocument(start, patch, deps.registries);
    return r.ok ? { doc: r.document } : { problems: formatDiagnostics(r.diagnostics) };
  });
}

async function runRepair(c: EvalCase, deps: CaseDeps, replay: ReturnType<typeof replayClient>): Promise<Outcome> {
  const broken = compile(c.inputs?.document ?? '', { registries: deps.registries });
  const lines = errorLines(broken.diagnostics);
  return converse(deps, `${c.prompt}\n\nThe file:\n${c.inputs?.document}\n\nProblems:\n${lines.join('\n')}\n\n${REPAIR_ASK}`, replay, (reply) => {
    const r = compile(unfence(reply), { registries: deps.registries });
    const errors = errorLines(r.diagnostics);
    return r.doc && errors.length === 0 ? { doc: r.doc } : { problems: errors };
  });
}

async function runGenerate(c: EvalCase, deps: CaseDeps, replay: ReturnType<typeof replayClient>): Promise<Outcome> {
  const r = await generateDeck({ client: replay.client, system: deps.system, compile: { registries: deps.registries }, prompt: c.prompt });
  const rounds = r.screens.map((s) => s.rounds);
  const clean = r.doc !== undefined && r.screens.length > 0 && r.screens.every((s) => s.ok && !s.lenient);
  return { doc: r.doc, attempts: clean ? 1 + Math.max(...rounds) : null, ...r.usage };
}

const RUNNERS = { generate: runGenerate, edit: runEdit, repair: runRepair } as const;

type Rec = { type: string; kind?: string };

function checkExpect(c: EvalCase, doc: DocumentFile, score: number): string[] {
  const records = Object.values(doc.records) as Rec[];
  const screens = records.filter((r) => r.type === 'screen').length;
  const [lo, hi] = c.expect.screens ?? [0, Number.POSITIVE_INFINITY];
  const all = JSON.stringify(doc.records);
  const lacking = (xs: readonly string[] | undefined, has: (x: string) => boolean, say: (x: string) => string) => (xs ?? []).filter((x) => !has(x)).map(say);
  return [
    ...(screens < lo || screens > hi ? [`${screens} screens, expected ${lo} to ${hi}`] : []),
    ...lacking(
      c.expect.kinds,
      (k) => records.some((r) => r.kind === k),
      (k) => `no ${k} element`,
    ),
    ...lacking(
      c.expect.mustContain,
      (s) => all.includes(s),
      (s) => `"${s}" does not appear`,
    ),
    ...(c.expect.minLint !== undefined && score < c.expect.minLint ? [`lint ${score} below ${c.expect.minLint}`] : []),
  ];
}

function altCoverage(doc: DocumentFile): number | null {
  const elements = Object.values(doc.records).filter((r) => (r as { type: string }).type === 'element') as {
    kind?: string;
    semantic?: { label?: string; role?: string };
  }[];
  const needing = elements.filter((e) => needsAlt({ id: '', rec: { id: '', type: 'element', ...e }, box: { x: 0, y: 0, w: 0, h: 0 }, text: '' } as never));
  if (needing.length === 0) return null;
  return (needing.filter((e) => typeof e.semantic?.label === 'string' && e.semantic.label !== '').length / needing.length) * 100;
}

const fail = (c: EvalCase, failures: string[]): CaseResult => ({
  id: c.id,
  mode: c.mode,
  attempts: null,
  pass: false,
  failures,
  lint: null,
  altCoveragePct: null,
  dslTokenRatio: null,
  tokensIn: 0,
  tokensOut: 0,
});

function measure(c: EvalCase, deps: CaseDeps, doc: DocumentFile, o: Outcome): CaseResult {
  const score = lint(doc, deps.lintRegistry).score;
  const failures = checkExpect(c, doc, score);
  return {
    id: c.id,
    mode: c.mode,
    attempts: o.attempts,
    pass: failures.length === 0,
    failures,
    lint: score,
    altCoveragePct: altCoverage(doc),
    dslTokenRatio: tokenRatio(c, deps, doc),
    tokensIn: o.tokensIn,
    tokensOut: o.tokensOut,
  };
}

function tokenRatio(c: EvalCase, deps: CaseDeps, doc: DocumentFile): number | null {
  if (c.mode !== 'generate' || !deps.countTokens) return null;
  const dsl = deps.countTokens(decompile(doc, { registries: deps.registries }).text);
  return dsl === 0 ? null : deps.countTokens(JSON.stringify(doc)) / dsl;
}

/**
 * Runs `c` on its recording and measures the result.
 *
 * @public
 */
export async function runCase(c: EvalCase, deps: CaseDeps): Promise<CaseResult> {
  if (!deps.recording) return fail(c, ['recording-missing']);
  const replay = replayClient(deps.recording);
  let o: Outcome;
  try {
    o = await RUNNERS[c.mode](c, deps, replay);
  } catch (e) {
    if (e instanceof LlmError) return fail(c, [replay.exhausted() ? 'recording-exhausted' : e.message]);
    throw e;
  }
  if (!o.doc || o.attempts === null) return { ...fail(c, ['never valid']), tokensIn: o.tokensIn, tokensOut: o.tokensOut };
  return measure(c, deps, o.doc, o);
}
