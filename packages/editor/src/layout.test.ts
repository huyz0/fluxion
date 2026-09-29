import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  dragSize,
  type EditorLayout,
  LAYOUT_KEY,
  PANEL_LIMITS,
  panelIds,
  panelShown,
  readLayout,
  resizePanel,
  SPLITTER_LARGE_STEP,
  SPLITTER_STEP,
  splitterKey,
  toggleFocus,
  togglePanel,
  togglePanelShown,
} from './layout.js';

const withPanel = (panel: 'left' | 'right' | 'bottom', size: number, collapsed = false): EditorLayout => ({
  ...DEFAULT_LAYOUT,
  panels: { ...DEFAULT_LAYOUT.panels, [panel]: { size, collapsed } },
});

describe('editor layout (FR-EDT-001, ADR-0029)', () => {
  it('FR-EDT-001: a first visit shows the side panels, the timeline collapsed, under a versioned key', () => {
    expect(LAYOUT_KEY).toBe('fluxion.editor.layout.v1');
    expect(DEFAULT_LAYOUT).toEqual({
      panels: { left: { size: 240, collapsed: false }, right: { size: 280, collapsed: false }, bottom: { size: 160, collapsed: true } },
      focus: false,
    });
    expect(panelIds()).toEqual(['left', 'right', 'bottom']);
    expect(PANEL_LIMITS).toEqual({ left: { min: 160, max: 480 }, right: { min: 200, max: 480 }, bottom: { min: 80, max: 400 } });
    expect([SPLITTER_STEP, SPLITTER_LARGE_STEP]).toEqual([10, 50]);
  });

  it('FR-EDT-001: a stored layout reads back as stored', () => {
    const stored = {
      panels: { left: { size: 300, collapsed: true }, right: { size: 200, collapsed: false }, bottom: { size: 400, collapsed: false } },
      focus: true,
    };
    expect(readLayout(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it('FR-EDT-001: a missing or broken stored layout gives the defaults, field by field', () => {
    for (const v of [undefined, null, 'x', 3, [], true]) expect(readLayout(v)).toBe(DEFAULT_LAYOUT);
    expect(readLayout({})).toEqual(DEFAULT_LAYOUT);
    expect(readLayout({ panels: [], focus: 'yes' })).toEqual(DEFAULT_LAYOUT);
    const broken = readLayout({
      panels: { left: { size: '300', collapsed: 1 }, right: 7, bottom: { size: Number.NaN, collapsed: false } },
      focus: 1,
    });
    expect(broken).toEqual({ ...DEFAULT_LAYOUT, panels: { ...DEFAULT_LAYOUT.panels, bottom: { size: 160, collapsed: false } } });
    expect(readLayout({ panels: { left: { size: Number.POSITIVE_INFINITY, collapsed: true } } }).panels.left).toEqual({ size: 240, collapsed: true });
  });

  it('FR-EDT-001: stored sizes are rounded and clamped to each panel`s limits', () => {
    const r = readLayout({
      panels: { left: { size: 5, collapsed: false }, right: { size: 9000, collapsed: false }, bottom: { size: 99.6, collapsed: false } },
    });
    expect([r.panels.left.size, r.panels.right.size, r.panels.bottom.size]).toEqual([160, 480, 100]);
    expect(readLayout({ panels: { right: { size: 200, collapsed: false } } }).panels.right.size).toBe(200);
    expect(readLayout({ panels: { right: { size: 480, collapsed: false } } }).panels.right.size).toBe(480);
  });

  it('FR-EDT-001: resizing clamps and opens a collapsed panel; the others are untouched', () => {
    expect(resizePanel(DEFAULT_LAYOUT, 'bottom', 250).panels).toEqual({ ...DEFAULT_LAYOUT.panels, bottom: { size: 250, collapsed: false } });
    expect(resizePanel(DEFAULT_LAYOUT, 'left', 10).panels.left.size).toBe(160);
    expect(resizePanel(DEFAULT_LAYOUT, 'left', 1000).panels.left.size).toBe(480);
    expect(resizePanel({ ...DEFAULT_LAYOUT, focus: true }, 'left', 300).focus).toBe(true);
  });

  it('FR-EDT-001: a panel hides and shows again at its size; focus mode hides every panel', () => {
    const hidden = togglePanel(withPanel('left', 333), 'left');
    expect(hidden.panels.left).toEqual({ size: 333, collapsed: true });
    expect(panelShown(hidden, 'left')).toBe(false);
    expect(togglePanel(hidden, 'left').panels.left).toEqual({ size: 333, collapsed: false });
    const focused = toggleFocus(DEFAULT_LAYOUT);
    expect(focused).toEqual({ ...DEFAULT_LAYOUT, focus: true });
    expect(panelIds().map((p) => panelShown(focused, p))).toEqual([false, false, false]);
    expect(panelIds().map((p) => panelShown(DEFAULT_LAYOUT, p))).toEqual([true, true, false]);
    expect(toggleFocus(focused).focus).toBe(false);
  });

  it('FR-EDT-001: a splitter drag grows each panel toward the canvas', () => {
    expect(dragSize('left', 240, 30, 99)).toBe(270);
    expect(dragSize('right', 280, 30, 99)).toBe(250);
    expect(dragSize('bottom', 160, 99, -40)).toBe(200);
    expect(dragSize('left', 240, -500, 0)).toBe(160);
    expect(dragSize('bottom', 160, 0, -1000)).toBe(400);
  });

  it('FR-EDT-001: splitter keys follow the WAI-ARIA window splitter pattern', () => {
    const size = (l: EditorLayout | undefined, p: 'left' | 'right' | 'bottom') => l?.panels[p].size;
    expect(size(splitterKey(DEFAULT_LAYOUT, 'left', 'ArrowRight', false), 'left')).toBe(250);
    expect(size(splitterKey(DEFAULT_LAYOUT, 'left', 'ArrowLeft', true), 'left')).toBe(190);
    expect(size(splitterKey(DEFAULT_LAYOUT, 'right', 'ArrowLeft', false), 'right')).toBe(290);
    expect(size(splitterKey(DEFAULT_LAYOUT, 'right', 'ArrowRight', false), 'right')).toBe(270);
    const open = withPanel('bottom', 160);
    expect(size(splitterKey(open, 'bottom', 'ArrowUp', true), 'bottom')).toBe(210);
    expect(size(splitterKey(open, 'bottom', 'ArrowDown', false), 'bottom')).toBe(150);
    expect(size(splitterKey(DEFAULT_LAYOUT, 'left', 'Home', false), 'left')).toBe(160);
    expect(size(splitterKey(DEFAULT_LAYOUT, 'left', 'End', false), 'left')).toBe(480);
    expect(splitterKey(DEFAULT_LAYOUT, 'left', 'ArrowUp', false)).toBeUndefined();
    expect(splitterKey(DEFAULT_LAYOUT, 'left', 'a', false)).toBeUndefined();
  });

  it('FR-EDT-001: Enter collapses and restores; a collapsed panel opens at its minimum and does not shrink', () => {
    const collapsed = splitterKey(DEFAULT_LAYOUT, 'left', 'Enter', false);
    expect(collapsed?.panels.left).toEqual({ size: 240, collapsed: true });
    expect(collapsed && splitterKey(collapsed, 'left', 'Enter', false)?.panels.left).toEqual({ size: 240, collapsed: false });
    expect(splitterKey(DEFAULT_LAYOUT, 'bottom', 'ArrowUp', false)?.panels.bottom).toEqual({ size: 80, collapsed: false });
    expect(splitterKey(DEFAULT_LAYOUT, 'bottom', 'ArrowDown', false)).toBe(DEFAULT_LAYOUT);
    expect(splitterKey(DEFAULT_LAYOUT, 'bottom', 'End', false)?.panels.bottom).toEqual({ size: 400, collapsed: false });
  });
});

describe('the panel buttons (FR-EDT-001)', () => {
  it('FR-EDT-001: a shown panel collapses; a hidden one opens and leaves focus mode', () => {
    expect(togglePanelShown(DEFAULT_LAYOUT, 'left').panels.left).toEqual({ size: 240, collapsed: true });
    expect(togglePanelShown(DEFAULT_LAYOUT, 'bottom')).toEqual({
      ...DEFAULT_LAYOUT,
      panels: { ...DEFAULT_LAYOUT.panels, bottom: { size: 160, collapsed: false } },
    });
    const focused = { ...DEFAULT_LAYOUT, focus: true };
    expect(togglePanelShown(focused, 'left')).toEqual(DEFAULT_LAYOUT);
    expect(togglePanelShown(focused, 'bottom')).toEqual(togglePanelShown(DEFAULT_LAYOUT, 'bottom'));
  });
});
