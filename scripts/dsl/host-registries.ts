// The registries of a host for the example corpus runners (scripts/dsl) and the eval (scripts/eval): the bundled packs, then the built-in layouts
// and templates. The example corpus adds the cloud pack (cloud-architecture, M18.41); the eval does not, so its prompt lists every pack it has in
// full and names no pack a scripted run cannot expand (M18.218, cp32 F3).
import { registerBuiltInLayouts, registerBuiltInTemplates } from '@fluxion/layout';
import { basicPack } from '@fluxion/pack-basic';
import { cloudPack } from '@fluxion/pack-cloud-architecture';
import { themesCorePack } from '@fluxion/pack-themes-core';
import { type CoreRegistries, createCoreRegistries, type Pack } from '@fluxion/sdk';

/** The packs the example corpus uses beyond the bundled ones. */
export const EXAMPLE_PACKS: readonly Pack[] = [cloudPack];

/** Fresh registries as a host has them: the bundled packs and `extra`, then the built-in layouts and templates. */
export function registries(extra: readonly Pack[] = []): CoreRegistries {
  const r = createCoreRegistries();
  for (const pack of [basicPack, ...extra, themesCorePack]) {
    const done = pack.register(r);
    if (!done.ok) throw new Error(`pack ${pack.id} failed to register: ${done.error.map((d) => d.message).join('; ')}`);
  }
  const layouts = registerBuiltInLayouts(r.layouts);
  if (!layouts.ok) throw new Error('the built-in layouts failed to register');
  const templates = registerBuiltInTemplates(r.templates);
  if (!templates.ok) throw new Error('the built-in templates failed to register');
  return r;
}
