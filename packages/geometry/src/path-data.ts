// SVG path data a shape owns (ADR-0053, FR-SHP-010): `M`, `L`, `Q`, `C` and `Z` in absolute coordinates, read into one command
// list per subpath. A command letter may be followed by several coordinate groups (an `M`'s further groups are lines, as in SVG).
// Pure: no DOM, the same numbers in every engine.
import type { GeometryError } from './errors.js';
import type { PathCommand } from './path.js';
import { err, ok, type Result } from './result.js';
import type { Vec2 } from './vec2.js';

/** Numbers each command takes. */
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
const TOKEN = /([MLQCZ])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([\s,]+)|(.)/g;

const fail = (message: string): Result<never, GeometryError> => err({ code: 'PATH_DATA_INVALID', message });

/** The letters and numbers of `d`, or the first character that is neither. */
function tokens(d: string): Result<Array<string | number>, GeometryError> {
  const out: Array<string | number> = [];
  for (const m of d.matchAll(TOKEN)) {
    if (m[4] !== undefined) return fail(`"${m[4]}" at ${m.index} is not M, L, Q, C, Z or a number`);
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(Number(m[2]));
  }
  return ok(out);
}

/** The command `letter` with the points of `n` (its numbers, in order). */
function command(letter: string, n: readonly number[]): PathCommand {
  const p = (i: number): Vec2 => ({ x: n[i] as number, y: n[i + 1] as number });
  if (letter === 'M') return { kind: 'M', to: p(0) };
  if (letter === 'L') return { kind: 'L', to: p(0) };
  if (letter === 'Q') return { kind: 'Q', control: p(0), to: p(2) };
  return { kind: 'C', control1: p(0), control2: p(2), to: p(4) };
}

/** The coordinate groups of `letter` from token `i` of `list` into `subpaths`; the index after them, or the failure. */
function groupsOf(letter: string, list: readonly (string | number)[], start: number, subpaths: PathCommand[][]): Result<number, GeometryError> {
  const arity = ARITY[letter] as number;
  let i = start;
  while (typeof list[i] === 'number') {
    const n = list.slice(i, i + arity);
    if (n.length < arity || n.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return fail(`${letter} needs ${arity} finite numbers`);
    // an M opens a subpath; the coordinate groups after its first draw lines (SVG)
    const kind = letter === 'M' && i > start ? 'L' : letter;
    if (kind === 'M') subpaths.push([]);
    (subpaths.at(-1) as PathCommand[]).push(command(kind, n as number[]));
    i += arity;
  }
  return i === start ? fail(`${letter} needs ${arity} numbers`) : ok(i);
}

/**
 * The subpaths of the path data `d` (absolute `M L Q C Z`), each a command list starting with its `M`. Errors:
 * `'PATH_DATA_INVALID'` for another letter, a missing or partial coordinate group, a non-finite number or data not starting with `M`.
 *
 * @public
 */
export function parsePathData(d: string): Result<readonly (readonly PathCommand[])[], GeometryError> {
  const read = tokens(d);
  if (!read.ok) return read;
  const subpaths: PathCommand[][] = [];
  const list = read.value;
  let i = 0;
  while (i < list.length) {
    const letter = list[i];
    if (typeof letter !== 'string') return fail(`a number at token ${i} has no command`);
    if (letter !== 'M' && subpaths.length === 0) return fail('path data starts with M');
    if (letter === 'Z') {
      (subpaths.at(-1) as PathCommand[]).push({ kind: 'Z' });
      i++;
      continue;
    }
    const next = groupsOf(letter, list, i + 1, subpaths);
    if (!next.ok) return next;
    i = next.value;
  }
  return subpaths.length === 0 ? fail('path data is empty') : ok(subpaths);
}
