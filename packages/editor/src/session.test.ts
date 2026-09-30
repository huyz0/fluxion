import { createCore, effect } from '@fluxion/core';
import { serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createSession, createSessions, DEFAULT_CAMERA } from './session.js';

/** Every object key anywhere in `value`. */
const keysOf = (value: unknown): string[] => (typeof value === 'object' && value !== null ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : []);

describe('editor session (FR-EDT-004, ADR-0028)', () => {
  it('FR-EDT-004: a saved document snapshot holds no session keys', () => {
    const b = documentBuilder({ seed: 41 });
    const screen = b.screen();
    const rect = b.rect(screen);
    const core = createCore(b.build());
    const before = serializeDocument(core.store.toDocument());
    const session = createSession('doc-1');
    session.selection.set([rect]);
    session.hover.set(rect);
    session.camera.set({ x: 123.5, y: -77.25, z: 3.5 });
    session.tool.set('probe-tool');
    const saved = serializeDocument(core.store.toDocument());
    expect(saved).toBe(before);
    const keys = keysOf(JSON.parse(saved));
    for (const key of ['selection', 'hover', 'camera', 'tool']) expect(keys).not.toContain(key);
    expect(saved).not.toContain('probe-tool');
    expect(saved).not.toContain('123.5');
  });

  it('FR-EDT-004: a new session selects and hovers nothing, with the select tool at 100 %', () => {
    const s = createSession('doc-2');
    expect(s.docId).toBe('doc-2');
    expect(s.selection.get()).toEqual([]);
    expect(s.hover.get()).toBeUndefined();
    expect(s.marquee.get()).toBeUndefined();
    expect(s.tool.get()).toBe('select');
    expect(s.camera.get()).toBe(DEFAULT_CAMERA);
    expect(DEFAULT_CAMERA).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('FR-EDT-004: each session value is its own signal: a hover change notifies no selection reader', () => {
    const s = createSession('doc-3');
    const reads: string[] = [];
    const stops = [
      effect(() => {
        reads.push(`selection:${s.selection.get().length}`);
      }),
      effect(() => {
        reads.push(`hover:${s.hover.get() ?? '-'}`);
      }),
    ];
    s.hover.set('a' as never);
    s.selection.set(['a' as never]);
    for (const stop of stops) stop();
    expect(reads).toEqual(['selection:0', 'hover:-', 'hover:a', 'selection:1']);
  });

  it('FR-EDT-004: there is one session per document id until it is dropped', () => {
    const sessions = createSessions();
    const a = sessions.get('a');
    a.tool.set('hand');
    expect(sessions.get('a')).toBe(a);
    expect(sessions.get('b')).not.toBe(a);
    expect(sessions.get('b').tool.get()).toBe('select');
    sessions.drop('a');
    const fresh = sessions.get('a');
    expect(fresh).not.toBe(a);
    expect(fresh.tool.get()).toBe('select');
    sessions.drop('never-opened');
    expect(sessions.get('b').docId).toBe('b');
  });
});
