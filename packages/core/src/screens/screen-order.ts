// Screen order in core (FR-SCR-002, M8.11): where a screen goes, and the next screen presentation shows.
import { compareKeys, DIAGNOSTIC_CODES, type Diagnostic, err, isIndexKey, jsonPointer, keyBetween, ok, type RecordId, type Result } from '@fluxion/schema';
import type { CommandContext } from '../commands.js';
import type { ReadView } from '../store.js';
import type { TxFailure } from '../transaction.js';

type Entry = { readonly id: RecordId; readonly index: string; readonly hidden: boolean };

/** The records of `type` (`screen` or `section`) in order (index, then id), hidden screens included, without `except`. */
function ordered(view: ReadView, except?: string, type = 'screen'): Entry[] {
  return view
    .members('byType', type)
    .filter((s) => s !== except)
    .map((s) => {
      const r = view.get(s) as { index?: unknown; hidden?: unknown } | undefined;
      return { id: s, index: String(r?.index ?? ''), hidden: r?.hidden === true };
    })
    .sort((a, b) => compareKeys(a.index, b.index) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The screen presentation shows after `from` (or before it, with `step` -1): the next in order that is not hidden;
 * undefined at the end. `from` may itself be hidden.
 *
 * @public
 */
export function nextVisibleScreen(view: ReadView, from: RecordId, step: 1 | -1 = 1): RecordId | undefined {
  const all = ordered(view);
  const at = all.findIndex((s) => s.id === from);
  if (at < 0) return undefined;
  const rest = step === 1 ? all.slice(at + 1) : all.slice(0, at).reverse();
  return rest.find((s) => !s.hidden)?.id;
}

/**
 * The index that puts a screen right after `after` (first when absent), or why none exists: a screen
 * cannot follow itself (COMMAND_ARGS), and neighbours with equal or malformed keys have no key between
 * them (TX_INVALID naming the neighbour's index; M3 final F5).
 */
export function screenIndexAfter(ctx: CommandContext, command: string, screen: string, after: string | undefined): Result<string, TxFailure> {
  return indexAfter(ctx, command, { type: 'screen', id: screen, after });
}

/** What {@link indexAfter} places: the record `id` of `type` right after `after` (first when absent). */
export type Placing = { readonly type: 'screen' | 'section'; readonly id: string; readonly after: string | undefined };

/** {@link screenIndexAfter} for screens and sections alike. */
export function indexAfter(ctx: CommandContext, command: string, placing: Placing): Result<string, TxFailure> {
  const { type, id: screen, after } = placing;
  const others = ordered(ctx.store, screen, type);
  // no screen has an undefined id, so an absent `after` finds nothing: at 0, first
  const at = others.findIndex((s) => s.id === after) + 1;
  if (after !== undefined && at === 0) {
    const message = `a ${type} cannot follow itself`;
    return err({
      code: 'COMMAND_ARGS',
      message: `${command}: ${message}`,
      diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', 'after']), message }],
    });
  }
  const [before, next] = [others[at - 1], others[at]];
  const key = keyBetween(before?.index ?? null, next?.index ?? null);
  if (key.ok) return ok(key.value);
  // an equal pair names the later key; a malformed key names the neighbour holding it (M4.4 review F1);
  // the severity is the code's registered one (review F2)
  const malformed = [before, next].find((s) => s !== undefined && !isIndexKey(s.index));
  // (an out-of-order pair has two valid keys, so no malformed one: it names `next` too)
  const neighbour = malformed ?? next ?? before;
  const code = key.error.code === 'INDEX_ORDER' ? 'FLX_INDEX_DUPLICATE' : 'FLX_SCHEMA_INVALID';
  const found: Diagnostic = {
    code,
    severity: DIAGNOSTIC_CODES[code],
    path: jsonPointer(['records', neighbour?.id ?? screen, 'index']),
    message: key.error.message,
  };
  return err({ code: 'TX_INVALID', message: `${command}: ${key.error.message}`, diagnostics: [found] });
}
