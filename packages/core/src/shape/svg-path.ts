// Complete SVG2 path command grammar; retain paint data, inspect finite derived coordinates.
import { SVG_POLICY_LIMITS } from '@fluxion/schema';
import { SvgNumbers } from './svg-numbers.js';

const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
type Point = readonly [number, number];
type Cursor = { current: Point; start: Point; control: Point; previous: string; extent: number };
type PathReader = { readonly cursor: Cursor; command: string; segments: number; started: boolean };

function point(values: readonly number[], i: number, origin: Point): Point {
  return [(values[i] ?? 0) + origin[0], (values[i + 1] ?? 0) + origin[1]];
}
function coordinates(opcode: string, values: readonly number[], origin: Point, current: Point): Point[] {
  if (opcode === 'H') return [[(values[0] ?? 0) + origin[0], current[1]]];
  if (opcode === 'V') return [[current[0], (values[0] ?? 0) + origin[1]]];
  if (opcode === 'A') return [point(values, 5, origin)];
  const points: Point[] = [];
  for (let i = 0; i < values.length; i += 2) points.push(point(values, i, origin));
  return points;
}
function reflectedControl(opcode: string, cursor: Cursor): Point {
  const reflected = (opcode === 'S' && ['C', 'S'].includes(cursor.previous)) || (opcode === 'T' && ['Q', 'T'].includes(cursor.previous));
  return reflected ? [2 * cursor.current[0] - cursor.control[0], 2 * cursor.current[1] - cursor.control[1]] : cursor.current;
}
function advance(command: string, values: readonly number[], cursor: Cursor): boolean {
  const opcode = command.toUpperCase();
  const points = coordinates(opcode, values, opcode === command ? [0, 0] : cursor.current, cursor.current);
  const control = reflectedControl(opcode, cursor);
  const numbers = [...values, ...points.flat(), ...control];
  if (!numbers.every(Number.isFinite)) return false;
  // A segment has at most seven numeric arguments and three coordinate pairs.
  cursor.extent = Math.max(cursor.extent, ...numbers.map(Math.abs));
  cursor.current = points.at(-1) ?? cursor.current;
  if (opcode === 'M') cursor.start = cursor.current;
  cursor.control = opcode === 'T' ? control : (points.at(-2) ?? cursor.current);
  cursor.previous = opcode;
  return true;
}
function argumentsOf(scanner: SvgNumbers, opcode: string, explicit: boolean): number[] | undefined {
  const count = ARITY[opcode];
  if (!count) return undefined;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = scanner.number({ first: explicit && i === 0, flag: opcode === 'A' && (i === 3 || i === 4) });
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}
function readSegment(scanner: SvgNumbers, reader: PathReader): boolean {
  const explicit = /^[a-zA-Z]$/.test(scanner.source[scanner.at] ?? '');
  if (explicit) reader.command = scanner.source[scanner.at++] ?? '';
  const opcode = reader.command.toUpperCase();
  if (!reader.started && opcode !== 'M') return false;
  reader.started = true;
  if (++reader.segments > SVG_POLICY_LIMITS.maxNodes) return false;
  if (opcode === 'Z') {
    reader.cursor.current = reader.cursor.start;
    reader.cursor.previous = 'Z';
    reader.command = '';
    return true;
  }
  const values = argumentsOf(scanner, opcode, explicit);
  if (!values || !advance(reader.command, values, reader.cursor)) return false;
  if (opcode === 'M') reader.command = reader.command === 'M' ? 'L' : 'l';
  return true;
}

/** Undefined denotes malformed/unbounded geometry; otherwise maximum absolute coordinate inspected. */
export function svgPathExtent(source: string): number | undefined {
  const scanner = new SvgNumbers(source);
  const reader: PathReader = { cursor: { current: [0, 0], start: [0, 0], control: [0, 0], previous: '', extent: 0 }, command: '', segments: 0, started: false };
  scanner.space();
  while (scanner.at < source.length) {
    if (!readSegment(scanner, reader)) return undefined;
    scanner.space();
  }
  return reader.cursor.extent;
}
