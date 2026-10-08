// Registries for the decompiler's tests, as compile.test.ts builds them: the checkout example's shapes (two with default sizes), a `rect`
// in two packs (so its short name is ambiguous when both are used), the light and ocean themes, and the built-in layouts.
import { type CoreRegistries, createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { LIGHT_THEME } from '@fluxion/theme';

export function registries(): CoreRegistries {
  const r = createCoreRegistries();
  const sized: { readonly [id: string]: { w: number; h: number } } = { 'basic:rounded-rect': { w: 200, h: 100 }, 'flowchart:database': { w: 120, h: 140 } };
  for (const id of ['basic:rect', 'basic:rounded-rect', 'flowchart:database', 'flowchart:queue', 'flowchart:rect', 'icons-lucide:globe', 'effects-core:dot'])
    r.shapeDefs.register(id, { id, ...(sized[id] ? { defaultSize: sized[id] } : {}) } as unknown as ShapeDef, id.split(':')[0] ?? id);
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  r.themes.register('themes-core:ocean', { ...LIGHT_THEME, id: 'themes-core:ocean', name: 'ocean' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}
