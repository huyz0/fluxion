// The studio's logger (NFR-OBS-001): the dev console, with the level and namespaces taken from the page's address (`?log=layout:*,render&level=debug`), so a problem can be
// looked into without a build. Warnings and errors are always written; the default level is `warn`.
import { type ConsoleLike, consoleSink, createLogger, type LogLevel, type NamespacedLogger } from '@fluxion/core';

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** The studio's logger for the page at `search` (`location.search`), writing to `target`. */
export function studioLogger(search: string, target: ConsoleLike): NamespacedLogger {
  const params = new URLSearchParams(search);
  const asked = params.get('level');
  const level = LEVELS.find((l) => l === asked) ?? 'warn';
  return createLogger({ sink: consoleSink(target), level, namespaces: params.get('log') ?? '*' });
}
