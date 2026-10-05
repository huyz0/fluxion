// The logger (NFR-OBS-001): structured, leveled entries with namespaces. Pure: the destination is a sink the host gives (a dev console, a test's array), so
// nothing here touches the console, a clock or the environment. A namespace is `layout` or `layout:route`; a filter lists namespaces to keep (`render,layout:*`,
// `*` for all) and namespaces to drop (`-noisy`).
import type { Logger, LogLevel } from './ports/ports.js';

/**
 * One log entry, as a sink receives it.
 *
 * @public
 */
export type LogEntry = {
  /** Severity. */
  readonly level: LogLevel;
  /** The namespace of the logger that wrote it (`''` for the root). */
  readonly namespace: string;
  /** The message. */
  readonly message: string;
  /** Structured fields. */
  readonly fields: Readonly<Record<string, unknown>>;
};

/**
 * A logger with namespaces: `child('layout')` writes under `layout`, and `child('route')` of that under `layout:route`.
 *
 * @public
 */
export interface NamespacedLogger extends Logger {
  /** The logger for `namespace` below this one. */
  child(namespace: string): NamespacedLogger;
}

/**
 * Options of {@link createLogger}.
 *
 * @public
 */
export type LoggerOptions = {
  /** Where entries go. */
  readonly sink: (entry: LogEntry) => void;
  /** The least severe level written (default `info`). */
  readonly level?: LogLevel;
  /** The namespaces written (default `*`, all): comma-separated patterns, `*` matching any run, a leading `-` dropping the namespace. */
  readonly namespaces?: string;
};

const ORDER: { readonly [level in LogLevel]: number } = { debug: 0, info: 1, warn: 2, error: 3 };

/** A pattern as a test of a namespace: `layout:*` matches `layout` and everything below it. */
function matcher(pattern: string): (namespace: string) => boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  const below = pattern.endsWith(':*') ? new RegExp(`^${escaped.slice(0, -3)}$`) : undefined;
  return (namespace) => re.test(namespace) || (below?.test(namespace) ?? false);
}

/**
 * Whether `namespace` passes the filter `spec`: some keep pattern matches and no drop pattern does. The root (`''`) passes unless a drop names it.
 *
 * @public
 */
export function namespaceEnabled(spec: string, namespace: string): boolean {
  const parts = spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const drops = parts.filter((p) => p.startsWith('-')).map((p) => matcher(p.slice(1)));
  const keeps = parts.filter((p) => !p.startsWith('-')).map(matcher);
  if (drops.some((drop) => drop(namespace))) return false;
  return keeps.length === 0 || namespace === '' || keeps.some((keep) => keep(namespace));
}

/**
 * A logger that writes entries at or above `level` whose namespace passes the filter to `sink`.
 *
 * @public
 */
export function createLogger(options: LoggerOptions): NamespacedLogger {
  const { sink, level = 'info', namespaces = '*' } = options;
  const make = (namespace: string): NamespacedLogger => ({
    log(at, message, fields = {}) {
      if (ORDER[at] >= ORDER[level] && namespaceEnabled(namespaces, namespace)) sink({ level: at, namespace, message, fields });
    },
    child: (name) => make(namespace === '' ? name : `${namespace}:${name}`),
  });
  return make('');
}

/**
 * The part of a console a sink writes to (the host's `console`, or a test's recorder).
 *
 * @public
 */
export type ConsoleLike = { readonly [level in LogLevel]: (...args: unknown[]) => void };

/**
 * A sink that writes each entry to `target` at its level: `[namespace] message` and the fields when there are any.
 *
 * @public
 */
export function consoleSink(target: ConsoleLike): (entry: LogEntry) => void {
  return (entry) => {
    const text = entry.namespace === '' ? entry.message : `[${entry.namespace}] ${entry.message}`;
    if (Object.keys(entry.fields).length === 0) target[entry.level](text);
    else target[entry.level](text, entry.fields);
  };
}
