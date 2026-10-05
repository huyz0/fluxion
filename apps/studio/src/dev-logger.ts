// The studio's logger (NFR-OBS-001): the dev console, with the level and namespaces taken from the page's address (`?log=layout:*,render&level=debug`), so a problem can be
// looked into without a build. Warnings and errors are always written; the default level is `warn`.
import { type ConsoleLike, consoleSink, createLogger, type LogEntry, type LogLevel, type NamespacedLogger, namespaceEnabled } from '@fluxion/core';

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const ORDER: { readonly [level in LogLevel]: number } = { debug: 0, info: 1, warn: 2, error: 3 };
/** How many warnings and errors the diagnostic report can draw on. */
const KEPT = 200;
const problems: LogEntry[] = [];

/** The warnings and errors logged so far (the latest few hundred), for the diagnostic report. */
export const loggedProblems = (): readonly LogEntry[] => problems;

/** The studio's logger for the page at `search` (`location.search`), writing to `target`; warnings and errors are also kept for the diagnostic report, whatever the level. */
export function studioLogger(search: string, target: ConsoleLike): NamespacedLogger {
  const params = new URLSearchParams(search);
  const asked = params.get('level');
  const level = LEVELS.find((l) => l === asked) ?? 'warn';
  const namespaces = params.get('log') ?? '*';
  const toConsole = consoleSink(target);
  return createLogger({
    level: 'debug',
    sink: (entry) => {
      if (ORDER[entry.level] >= ORDER.warn) {
        problems.push(entry);
        if (problems.length > KEPT) problems.shift();
      }
      if (ORDER[entry.level] >= ORDER[level] && namespaceEnabled(namespaces, entry.namespace)) toConsole(entry);
    },
  });
}
