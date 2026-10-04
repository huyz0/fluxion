// The one path policy of the `.flux` container, used by the loader (what it will unpack) and the writer (what it will emit), so the writer
// never produces a file its own loader refuses (FR-FIL-009): no empty, absolute, backslash, drive-letter, control-character, `.`, `..` or
// empty segments, and no two names that are one path on a case-insensitive or Unicode-normalising file system.

/** Why the entry name `name` must not be in an archive, if it must not. A directory entry ends in one `/`. */
export function unsafeName(name: string): string | undefined {
  if (name === '' || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) return 'it is empty, absolute or uses a backslash or drive letter';
  if ([...name].some((ch) => (ch.codePointAt(0) as number) < 0x20 || ch === '\u007f')) return 'it has a control character';
  const segments = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  if (segments.some((segment) => segment === '' || segment === '..' || segment === '.')) return 'it has an empty, `.` or `..` segment';
  return undefined;
}

/** What two names must differ in to be two files on a case-insensitive, normalising file system: case-folded, NFC, no directory slash. */
const collisionKey = (name: string): string => (name.endsWith('/') ? name.slice(0, -1) : name).normalize('NFC').toLowerCase();

/** The first problem with `names` (unsafe, or colliding once case and Unicode form are ignored), as a message. */
export function namesProblem(names: readonly string[]): string | undefined {
  const seen = new Map<string, string>();
  for (const name of names) {
    const why = unsafeName(name);
    if (why !== undefined) return `${JSON.stringify(name)}: ${why}`;
    const twin = seen.get(collisionKey(name));
    if (twin !== undefined) return `${JSON.stringify(name)} and ${JSON.stringify(twin)} are one path on a case-insensitive or normalising file system`;
    seen.set(collisionKey(name), name);
  }
  return undefined;
}

/** The manifest fields the writer and the loader know; any other field is kept as an extra. */
export const KNOWN_MANIFEST_KEYS: ReadonlySet<string> = new Set([
  'format',
  'formatVersion',
  'schemaVersion',
  'app',
  'generator',
  'title',
  'created',
  'modified',
  'entries',
  'plugins',
  'bakes',
  'source',
  'preview',
]);
