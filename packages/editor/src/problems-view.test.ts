import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it, vi } from 'vitest';
import { problemsOf } from './problems.js';

// every store built while the problems are worked out, counted (M20.39, cp4 F3)
const built = vi.hoisted(() => ({ count: 0 }));
vi.mock('@fluxion/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@fluxion/core')>();
  return {
    ...core,
    createStore: (...args: Parameters<typeof core.createStore>) => {
      built.count += 1;
      return core.createStore(...args);
    },
  };
});

describe('problems read one view of the document per pass (M20.39)', () => {
  it('NFR-A11Y-005: problemsOf builds one read view however many contrast fixes it offers', () => {
    const b = documentBuilder({ seed: 3 });
    const s = b.screen();
    // pale text on pale fills: one contrast finding with its fix each
    const pale = { fill: '#999999', font: { color: '#888888', size: 16 } };
    for (let i = 0; i < 6; i += 1) b.rect(s, { x: i * 120, y: 0, w: 100, h: 60, label: `t${i}`, style: pale });
    const doc = b.build();
    built.count = 0;
    const fixes = problemsOf(doc).filter((p) => p.fix?.title === 'Fix contrast');
    expect(fixes).toHaveLength(6);
    expect(built.count).toBe(1);
  });
});
