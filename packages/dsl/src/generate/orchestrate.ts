// The generation orchestrator (06-ai-authoring.md §8, FR-AI-009, FR-AI-004): outline, one streamed FluxScript screen at a time compiled into the
// running document, at most two repair rounds per screen, then a lenient compile with the auto-fixes as warnings, then lint.
import type { DocumentFile } from '@fluxion/schema';
import { compile } from '../compile.js';
import { formatDiagnostics } from '../diagnostics/format.js';
import { lint } from '../lint/lint.js';
import type { LintContext, LintRegistry, LintReport } from '../lint/types.js';
import type { CompileOptions, DslDiagnostic } from '../types.js';
import { type AbortSignalLike, type LlmClient, LlmError, type LlmRequest } from './llm.js';

/**
 * Repair rounds before the lenient compile.
 *
 * @public
 */
export const MAX_REPAIRS = 2;

/**
 * One screen of the outline.
 *
 * @public
 */
export type OutlineScreen = {
  /** The screen's slug. */
  readonly id: string;
  /** Its title. */
  readonly title: string;
  /** What it should say. */
  readonly intent: string;
};

/**
 * The outline arrived.
 *
 * @public
 */
export type OutlineEvent = {
  /** Discriminant. */
  readonly type: 'outline';
  /** The deck title. */
  readonly title: string;
  /** The screens to write. */
  readonly screens: readonly OutlineScreen[];
};

/**
 * A screen's text so far.
 *
 * @public
 */
export type ScreenTextEvent = {
  /** Discriminant. */
  readonly type: 'screen-text';
  /** The screen id. */
  readonly screen: string;
  /** The reply so far. */
  readonly text: string;
};

/**
 * A screen is being sent back for repair.
 *
 * @public
 */
export type RepairEvent = {
  /** Discriminant. */
  readonly type: 'repair';
  /** The screen id. */
  readonly screen: string;
  /** Which round, from 1. */
  readonly round: number;
  /** The formatted problems sent to the model. */
  readonly diagnostics: readonly string[];
};

/**
 * A screen is finished.
 *
 * @public
 */
export type ScreenDoneEvent = {
  /** Discriminant. */
  readonly type: 'screen-done';
  /** The screen id. */
  readonly screen: string;
  /** Repair rounds used. */
  readonly rounds: number;
  /** True when the lenient compile was needed. */
  readonly lenient: boolean;
  /** False when the screen could not be added. */
  readonly ok: boolean;
};

/**
 * What the orchestrator tells a listener while it works: the outline; the text of a screen so far; a repair round with its formatted
 * problems; a screen finished (rounds used, lenient or not, added or not).
 *
 * @public
 */
export type GenerateEvent = OutlineEvent | ScreenTextEvent | RepairEvent | ScreenDoneEvent;
/**
 * What to generate and with what.
 *
 * @public
 */
export type GenerateOptions = {
  /** The model. */
  readonly client: LlmClient;
  /** The standing instructions, normally the cheat sheet and the catalog. */
  readonly system: string;
  /** Registries and ids for the compile; `base`, `mode` are set by the orchestrator. */
  readonly compile: Omit<CompileOptions, 'base' | 'mode'>;
  /** What the deck is about. */
  readonly prompt: string;
  /** Packs the document uses (`uses:`); `basic` when omitted. */
  readonly uses?: readonly string[];
  /** Lint rules; the report is left out when omitted. */
  readonly lintRegistry?: LintRegistry;
  /** Lint context (text measurer). */
  readonly lintContext?: LintContext;
  /** Stops the run. */
  readonly signal?: AbortSignalLike;
  /** Hears the progress. */
  readonly onEvent?: (event: GenerateEvent) => void;
};

/**
 * How one screen ended.
 *
 * @public
 */
export type ScreenOutcome = {
  /** The outline id. */
  readonly id: string;
  /** Repair rounds used (0 to 2). */
  readonly rounds: number;
  /** True when the screen needed the lenient compile. */
  readonly lenient: boolean;
  /** False when the screen could not be added at all. */
  readonly ok: boolean;
};

/**
 * Tokens the provider reported.
 *
 * @public
 */
export type TokenUsage = {
  /** Tokens read. */
  readonly tokensIn: number;
  /** Tokens written. */
  readonly tokensOut: number;
};

/**
 * What a generation gives back.
 *
 * @public
 */
export type GenerateResult = {
  /** The document so far; absent when no screen compiled. */
  readonly doc?: DocumentFile;
  /** One entry per outline screen. */
  readonly screens: readonly ScreenOutcome[];
  /** Diagnostics of the final compile of each screen (warnings of lenient fixes, errors of a screen left out). */
  readonly diagnostics: readonly DslDiagnostic[];
  /** The lint report of the final document, when a registry was given. */
  readonly lint?: LintReport;
  /** Tokens the provider reported. */
  readonly usage: TokenUsage;
};

const NEVER: AbortSignalLike = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined };

const OUTLINE_ASK =
  'Reply with JSON only, no prose: {"title": string, "screens": [{"id": lower-case-slug, "title": string, "intent": string}]}. One item per screen, in story order.';

const SCREEN_ASK = (s: OutlineScreen) =>
  `Write the FluxScript for the screen "${s.id}" (${s.title}): ${s.intent}. Give every image, icon and role-bearing group an \`alt:\`, and write the nodes in reading order, top to bottom then left to right. Reply with that one \`- id: ${s.id}\` item of \`screens:\` only, no prose.`;

const REPAIR_ASK = (screen: string, text: string, lines: readonly string[]) =>
  `The screen "${screen}" did not compile. Problems, most important first:\n${lines.join('\n')}\n\nYour text was:\n${text}\n\nReply with the corrected \`- id: ${screen}\` item only, no prose.`;

type Run = { readonly options: GenerateOptions; readonly signal: AbortSignalLike; usage: { tokensIn: number; tokensOut: number } };

/** The whole reply of one request; streams `onText` as it grows. */
async function ask(run: Run, request: LlmRequest, onText?: (text: string) => void): Promise<string> {
  let text = '';
  if (run.signal.aborted) throw new LlmError('aborted');
  for await (const chunk of run.options.client.stream(request, run.signal)) {
    if (run.signal.aborted) throw new LlmError('aborted');
    if (chunk.type === 'text') {
      text += chunk.text;
      onText?.(text);
    } else if (chunk.type === 'usage') {
      run.usage = { tokensIn: run.usage.tokensIn + chunk.tokensIn, tokensOut: run.usage.tokensOut + chunk.tokensOut };
    }
  }
  return text;
}

/**
 * An outline: the deck title and its screens.
 *
 * @public
 */
export type ParsedOutline = {
  /** The deck title. */
  readonly title: string;
  /** The screens in story order. */
  readonly screens: readonly OutlineScreen[];
};

/**
 * The text without a surrounding code fence.
 *
 * @public
 */
export function unfence(text: string): string {
  const m = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return (m?.[1] ?? text).trim();
}

/**
 * The outline in a reply, or undefined when it is not the JSON asked for.
 *
 * @public
 */
export function parseOutline(text: string): ParsedOutline | undefined {
  let value: unknown;
  try {
    value = JSON.parse(unfence(text));
  } catch {
    return undefined;
  }
  const o = value as { title?: unknown; screens?: unknown } | null;
  if (typeof o?.title !== 'string' || !Array.isArray(o.screens) || o.screens.length === 0) return undefined;
  const screens: OutlineScreen[] = [];
  for (const s of o.screens as { id?: unknown; title?: unknown; intent?: unknown }[]) {
    if (typeof s?.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(s.id)) return undefined;
    screens.push({ id: s.id, title: typeof s.title === 'string' ? s.title : s.id, intent: typeof s.intent === 'string' ? s.intent : '' });
  }
  return { title: o.title, screens };
}

/** A complete file for one screen item: the header from the outline, then the item indented under `screens:`. */
function fileFor(header: string, reply: string): string {
  const body = unfence(reply);
  if (/^screens:/m.test(body)) return body;
  const first = body.split('\n').find((l) => l.trim() !== '') ?? '';
  const indented = /^-/.test(first)
    ? body
        .split('\n')
        .map((l) => (l === '' ? l : `  ${l}`))
        .join('\n')
    : body;
  return `${header}screens:\n${indented}\n`;
}

const errorsOf = (ds: readonly DslDiagnostic[]) => ds.filter((d) => d.severity === 'error');

type Step = { doc: DocumentFile | undefined; diagnostics: readonly DslDiagnostic[]; outcome: ScreenOutcome };

/** One screen: write, compile into `base`, repair up to twice, then compile leniently. */
async function oneScreen(run: Run, header: string, screen: OutlineScreen, base: DocumentFile | undefined): Promise<Step> {
  const { options } = run;
  const emit = options.onEvent;
  const compileWith = (text: string, mode: 'strict' | 'lenient') => compile(text, { ...options.compile, mode, ...(base ? { base } : {}) });
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: SCREEN_ASK(screen) }];
  let reply = await ask(run, { system: options.system, messages }, (text) => emit?.({ type: 'screen-text', screen: screen.id, text }));
  let result = compileWith(fileFor(header, reply), 'strict');
  let rounds = 0;
  while (errorsOf(result.diagnostics).length > 0 && rounds < MAX_REPAIRS) {
    rounds++;
    const lines = formatDiagnostics(errorsOf(result.diagnostics));
    emit?.({ type: 'repair', screen: screen.id, round: rounds, diagnostics: lines });
    messages.push({ role: 'assistant', content: reply }, { role: 'user', content: REPAIR_ASK(screen.id, reply, lines) });
    reply = await ask(run, { system: options.system, messages });
    result = compileWith(fileFor(header, reply), 'strict');
  }
  let lenient = false;
  if (errorsOf(result.diagnostics).length > 0) {
    lenient = true;
    result = compileWith(fileFor(header, reply), 'lenient');
  }
  const ok = result.doc !== undefined && errorsOf(result.diagnostics).length === 0;
  emit?.({ type: 'screen-done', screen: screen.id, rounds, lenient, ok });
  return {
    doc: ok ? result.doc : base,
    diagnostics: result.diagnostics.filter((d) => lenient || d.severity !== 'info'),
    outcome: { id: screen.id, rounds, lenient, ok },
  };
}

/**
 * Generates a deck: asks for an outline, then for each screen in turn, compiling each into the running document. A screen with errors is
 * sent back with the formatted diagnostics at most {@link MAX_REPAIRS} times; if it still fails it is compiled leniently (auto-fixes become
 * warnings), and if even that leaves errors the screen is left out and reported.
 *
 * @param options - the client, prompts, compile options and listener
 * @returns the document, how each screen ended, the diagnostics, the lint report and the token usage
 * @throws LlmError - the provider failed or the run was aborted
 * @public
 */
export async function generateDeck(options: GenerateOptions): Promise<GenerateResult> {
  const run: Run = { options, signal: options.signal ?? NEVER, usage: { tokensIn: 0, tokensOut: 0 } };
  const raw = await ask(run, { system: options.system, messages: [{ role: 'user', content: `${options.prompt}\n\n${OUTLINE_ASK}` }] });
  const outline = parseOutline(raw);
  if (!outline) {
    const message = 'the reply is not the outline JSON asked for';
    return { screens: [], diagnostics: [{ code: 'FLX_DSL_SYNTAX', severity: 'error', message, path: '/' }], usage: run.usage };
  }
  options.onEvent?.({ type: 'outline', title: outline.title, screens: outline.screens });
  const header = `flux: 1\ntitle: ${JSON.stringify(outline.title)}\nuses: [${(options.uses ?? ['basic']).join(', ')}]\n`;
  let doc: DocumentFile | undefined;
  const screens: ScreenOutcome[] = [];
  const diagnostics: DslDiagnostic[] = [];
  for (const screen of outline.screens) {
    const step = await oneScreen(run, header, screen, doc);
    doc = step.doc;
    screens.push(step.outcome);
    diagnostics.push(...step.diagnostics);
  }
  const report = doc && options.lintRegistry ? lint(doc, options.lintRegistry, options.lintContext) : undefined;
  return { ...(doc ? { doc } : {}), screens, diagnostics, ...(report ? { lint: report } : {}), usage: run.usage };
}
