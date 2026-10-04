// Recovering what a cut-off `document.json` still holds (FR-FIL-009, NFR-REL-002). A file that stops in the middle (a disk that filled, a
// download that ended early) is not JSON, but the records written before the cut are whole JSON values: this reads the top-level object
// with a tolerant scanner and keeps every complete `records` entry and the `schemaVersion` if it came before the cut. It never throws
// and does not recurse, so nesting cannot overflow the stack.

/** What was found before the cut. */
export type RecoveredText = {
  /** The complete record entries, by id. */
  readonly records: { [id: string]: unknown };
  /** The `schemaVersion` string, when the cut came after it. */
  readonly schemaVersion?: string;
};

const WHITESPACE = new Set([' ', '\n', '\r', '\t']);
/** What ends a number or literal. */
const DELIMITERS = new Set([',', ':', '}', ']', ...WHITESPACE]);
const OPENING = new Set(['{', '[']);
const CLOSING = new Set(['}', ']']);

/** The end of the string literal that starts at `start`, or -1 when the text ends inside it. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}

/** How a character changes the nesting depth: opening +1, closing -1, anything else 0. */
const depthChange = (ch: string): number => (OPENING.has(ch) ? 1 : CLOSING.has(ch) ? -1 : 0);

/** The end of the object or array that starts at `start` (strings skipped, no recursion), or -1 when the text ends inside it. */
function containerEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text[i] === '"') {
      i = stringEnd(text, i);
      if (i < 0) return -1;
      continue;
    }
    depth += depthChange(text[i] as string);
    i++;
    if (depth === 0) return i;
  }
  return -1;
}

/** The end of the number or literal at `start`: a delimiter must follow, or it may have been cut short (-1). */
function scalarEnd(text: string, start: number): number {
  for (let i = start; i < text.length; i++) if (DELIMITERS.has(text[i] as string)) return i > start ? i : -1;
  return -1;
}

/** A cursor over the text. */
class Scanner {
  pos = 0;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  skip(): void {
    while (this.pos < this.text.length && WHITESPACE.has(this.text[this.pos] as string)) this.pos++;
  }

  /** Consume `ch` (after whitespace); false when the text has something else or ends. */
  take(ch: string): boolean {
    this.skip();
    if (this.text[this.pos] !== ch) return false;
    this.pos++;
    return true;
  }

  peek(): string | undefined {
    this.skip();
    return this.text[this.pos];
  }

  /** The end (exclusive) of the complete JSON value that starts at the cursor, or -1 when the text ends inside it. */
  valueEnd(): number {
    this.skip();
    const first = this.text[this.pos];
    if (first === '"') return stringEnd(this.text, this.pos);
    if (first === '{' || first === '[') return containerEnd(this.text, this.pos);
    return scalarEnd(this.text, this.pos);
  }

  /** The complete JSON value at the cursor, advancing past it; undefined when it is cut off or not JSON. */
  value(): { readonly value: unknown } | undefined {
    const end = this.valueEnd();
    if (end < 0) return undefined;
    const raw = this.text.slice(this.pos, end);
    try {
      const value: unknown = JSON.parse(raw);
      this.pos = end;
      return { value };
    } catch {
      return undefined;
    }
  }
}

/** The entries of the `records` object the cursor is at, as many as are complete. */
function readRecords(s: Scanner, into: { [id: string]: unknown }): boolean {
  if (!s.take('{')) return false;
  while (s.peek() === '"') {
    const key = s.value();
    if (key === undefined || typeof key.value !== 'string' || !s.take(':')) return false;
    const entry = s.value();
    if (entry === undefined) return false;
    into[key.value] = entry.value;
    if (!s.take(',')) return s.take('}');
  }
  return s.take('}');
}

/** Read one member of the top-level object into `out`; false when the text ends or is not a member. */
function readMember(s: Scanner, out: { records: { [id: string]: unknown }; schemaVersion?: string }): boolean {
  const key = s.value();
  if (key === undefined || typeof key.value !== 'string' || !s.take(':')) return false;
  if (key.value === 'records') return readRecords(s, out.records);
  const value = s.value();
  if (value === undefined) return false;
  if (key.value === 'schemaVersion' && typeof value.value === 'string') out.schemaVersion = value.value;
  return true;
}

/**
 * The records and version a cut-off `document.json` still holds. Undefined when no record could be read.
 */
export function recoverTruncated(text: string): RecoveredText | undefined {
  const s = new Scanner(text);
  const out: { records: { [id: string]: unknown }; schemaVersion?: string } = { records: Object.create(null) as { [id: string]: unknown } };
  if (s.take('{')) {
    while (s.peek() === '"' && readMember(s, out) && s.take(',')) {
      // next member
    }
  }
  return Object.keys(out.records).length === 0 ? undefined : out;
}
