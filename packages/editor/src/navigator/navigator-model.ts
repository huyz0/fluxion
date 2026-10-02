// The screens navigator's model (FR-SCR-002, M8.12): where a dragged screen lands, and the records the add and
// duplicate commands are given. Pure; the panel (screens-tab.tsx) shows it.
import { type ReadView, screenRecordsToCopy } from '@fluxion/core';
import { screensInOrder } from '@fluxion/render';
import { keyBetween, presetOf, type RecordId, SCREEN_PRESETS, type ScreenRecord, type Size, screenKind, screenSize } from '@fluxion/schema';

/**
 * The screen a dragged screen should follow when dropped on `target` (above it, or below with `below`): undefined
 * for the first place; `null` when the drop changes nothing (on itself, or where it already is).
 */
export function dropAfter(order: readonly RecordId[], dragged: RecordId, target: RecordId, below: boolean): RecordId | undefined | null {
  if (dragged === target) return null;
  const others = order.filter((s) => s !== dragged);
  const at = others.indexOf(target) + (below ? 1 : 0);
  const after = others[at - 1];
  return order.indexOf(dragged) === at ? null : after;
}

/** The record of a new screen `id` after the last one. */
export function newScreen(view: ReadView, id: RecordId): { id: RecordId; type: 'screen'; index: string } {
  const last = screensInOrder(view, true).at(-1);
  const after = last === undefined ? null : String((view.get(last) as { index?: unknown }).index);
  const key = keyBetween(after, null);
  return { id, type: 'screen', index: key.ok ? key.value : 'a0' };
}

/** The arguments that duplicate `screen`: a new screen id, and a new id for each record it copies. */
export function duplicateArgs(view: ReadView, screen: RecordId, newId: () => RecordId): { id: RecordId; newId: RecordId; ids: Record<string, RecordId> } {
  return { id: screen, newId: newId(), ids: Object.fromEntries(screenRecordsToCopy(view, screen).map((r) => [r, newId()])) };
}

/** The menu command that sets a preset's format, or the infinite or custom one. */
export const FORMAT_PREFIX = 'screen.format:';

/** The format lines of the screen menu: a preset each, the infinite screen, and a size typed in. */
export const FORMAT_ITEMS: readonly { readonly command: string; readonly title: string }[] = [
  ...SCREEN_PRESETS.map((p) => ({ command: `${FORMAT_PREFIX}${p.id}`, title: `Format: ${p.label}` })),
  { command: `${FORMAT_PREFIX}infinite`, title: 'Format: Infinite canvas' },
  { command: `${FORMAT_PREFIX}custom`, title: 'Format: Custom size…' },
];

/** The arguments of `screen.setFormat`. */
export type SetFormatArgs = {
  readonly id: RecordId;
  readonly format:
    | { readonly kind: 'fixed'; readonly size: Size }
    | { readonly kind: 'infinite'; readonly viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } };
};

/** The size a screen shows: a fixed screen's, or an infinite screen's viewport. */
export function shownSize(screen: Pick<ScreenRecord, 'kind' | 'size' | 'viewport'>): Size {
  return screenKind(screen) === 'infinite' && screen.viewport !== undefined ? { w: screen.viewport.w, h: screen.viewport.h } : screenSize(screen);
}

/** The `screen.setFormat` arguments the format command `command` gives screen `id` (undefined for `custom`, which asks for a size, and for an unknown one). */
export function formatArgs(command: string, id: RecordId, current: Size & { readonly infinite?: boolean }): SetFormatArgs | undefined {
  const name = command.slice(FORMAT_PREFIX.length);
  // already infinite: its viewport stays as the user left it
  if (name === 'infinite')
    return current.infinite === true ? undefined : { id, format: { kind: 'infinite' as const, viewport: { x: 0, y: 0, w: current.w, h: current.h } } };
  const preset = SCREEN_PRESETS.find((p) => p.id === name);
  return preset === undefined ? undefined : { id, format: { kind: 'fixed' as const, size: preset.size } };
}

/** A size typed as `1280x720` (or `1280 × 720`, or with a comma), whole pixels from 16 to 20000; undefined for anything else. */
export function parseSize(text: string): Size | undefined {
  const m = /^\s*(\d+)\s*[x×,]\s*(\d+)\s*$/i.exec(text);
  const [w, h] = [Number(m?.[1]), Number(m?.[2])];
  const ok = (n: number) => n >= 16 && n <= 20000;
  return m !== null && ok(w) && ok(h) ? { w, h } : undefined;
}

/** What the navigator shows of a screen's format: its preset, `1280×720`, or `Infinite`. */
export function formatLabel(screen: Pick<ScreenRecord, 'kind' | 'size'>): string {
  if (screenKind(screen) === 'infinite') return 'Infinite';
  const size = screenSize(screen);
  return presetOf(size)?.label ?? `${size.w}×${size.h}`;
}

/** A screen as the navigator lists it. */
export type Row = {
  readonly id: RecordId;
  readonly label: string;
  readonly hidden: boolean;
  /** Its format as the row shows it, and the size an infinite or custom format starts from. */
  readonly format: string;
  readonly size: { readonly w: number; readonly h: number };
  /** The section it is in, if one that exists. */
  readonly sectionId?: RecordId | undefined;
};

/** A section as the navigator lists it. */
export type SectionRow = { readonly id: RecordId; readonly name: string; readonly collapsed: boolean };

/** One line of the navigator: a section's header, or a screen. */
export type Item = { readonly kind: 'section'; readonly section: SectionRow; readonly count: number } | { readonly kind: 'screen'; readonly row: Row };

/**
 * The navigator's lines: the screens in no section first, then each section's header with its screens, sections in order
 * and screens in their own order; a folded section shows its header alone.
 */
export function navigatorItems(rows: readonly Row[], sections: readonly SectionRow[]): Item[] {
  const known = new Set(sections.map((s) => s.id));
  const inSection = (id: RecordId | undefined) => rows.filter((r) => (r.sectionId !== undefined && known.has(r.sectionId) ? r.sectionId : undefined) === id);
  const free = inSection(undefined).map((row): Item => ({ kind: 'screen', row }));
  const grouped = sections.flatMap((section): Item[] => {
    const own = inSection(section.id);
    return [{ kind: 'section', section, count: own.length }, ...(section.collapsed ? [] : own.map((row): Item => ({ kind: 'screen', row })))];
  });
  return [...free, ...grouped];
}

/** The menu command that moves a screen to a section (or out of all, with `none`). */
export const SECTION_PREFIX = 'screen.section:';

/** The screen menu's lines for moving a screen to a section other than its own, or out of its section. */
export function sectionMoves(sections: readonly SectionRow[], current: RecordId | undefined): readonly { readonly command: string; readonly title: string }[] {
  const to = sections.filter((s) => s.id !== current).map((s) => ({ command: `${SECTION_PREFIX}${s.id}`, title: `Move to section: ${s.name}` }));
  return current === undefined ? to : [...to, { command: `${SECTION_PREFIX}none`, title: 'Remove from section' }];
}
