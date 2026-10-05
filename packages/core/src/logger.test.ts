import { describe, expect, it } from 'vitest';
import { type ConsoleLike, consoleSink, createLogger, type LogEntry, namespaceEnabled } from './logger.js';

function collect(options: { level?: 'debug' | 'info' | 'warn' | 'error'; namespaces?: string } = {}) {
  const entries: LogEntry[] = [];
  return { entries, root: createLogger({ sink: (e) => entries.push(e), ...options }) };
}

describe('the logger (NFR-OBS-001)', () => {
  it('NFR-OBS-001: the logger honours its level and namespaces', () => {
    // the level: info by default, so debug is dropped and the rest kept in order
    const a = collect();
    a.root.log('debug', 'quiet');
    a.root.log('info', 'one', { n: 1 });
    a.root.log('warn', 'two');
    a.root.log('error', 'three');
    expect(a.entries.map((e) => [e.level, e.message])).toEqual([
      ['info', 'one'],
      ['warn', 'two'],
      ['error', 'three'],
    ]);
    expect(a.entries[0]).toEqual({ level: 'info', namespace: '', message: 'one', fields: { n: 1 } });
    // a stricter level drops more, a looser one keeps debug
    const warn = collect({ level: 'warn' });
    warn.root.log('info', 'no');
    warn.root.log('warn', 'yes');
    expect(warn.entries.map((e) => e.message)).toEqual(['yes']);
    const debug = collect({ level: 'debug' });
    debug.root.log('debug', 'kept');
    expect(debug.entries).toHaveLength(1);
    // namespaces nest with a colon and are filtered by pattern
    const ns = collect({ namespaces: 'render,layout:*,-layout:noisy' });
    const layout = ns.root.child('layout');
    layout.child('route').log('info', 'route');
    layout.child('noisy').log('info', 'noisy');
    layout.log('info', 'layout itself');
    ns.root.child('render').log('info', 'render');
    ns.root.child('editor').log('info', 'editor');
    ns.root.log('info', 'root');
    expect(ns.entries.map((e) => [e.namespace, e.message])).toEqual([
      ['layout:route', 'route'],
      ['layout', 'layout itself'],
      ['render', 'render'],
      ['', 'root'],
    ]);
  });

  it('NFR-OBS-001: a filter keeps or drops by pattern, and a drop wins', () => {
    expect(namespaceEnabled('*', 'anything')).toBe(true);
    expect(namespaceEnabled('', 'anything')).toBe(true);
    expect(namespaceEnabled('render', 'render:view')).toBe(false);
    expect(namespaceEnabled('render:*', 'render:view')).toBe(true);
    expect(namespaceEnabled('render:*', 'renderer')).toBe(false);
    expect(namespaceEnabled('*,-render:*', 'render:view')).toBe(false);
    expect(namespaceEnabled('-render', 'layout')).toBe(true);
    // pattern characters that are not wildcards are literal
    expect(namespaceEnabled('a.b', 'aXb')).toBe(false);
  });

  it('NFR-OBS-001: the console sink writes each entry to the console method of its level, with its namespace and fields', () => {
    const written: unknown[][] = [];
    const record =
      (level: string) =>
      (...args: unknown[]) =>
        void written.push([level, ...args]);
    const target: ConsoleLike = { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
    const logger = createLogger({ sink: consoleSink(target), level: 'debug' });
    logger.log('info', 'plain');
    logger.child('layout').log('warn', 'slow', { ms: 40 });
    logger.child('render').log('debug', 'drawn');
    expect(written).toEqual([
      ['info', 'plain'],
      ['warn', '[layout] slow', { ms: 40 }],
      ['debug', '[render] drawn'],
    ]);
  });
});
