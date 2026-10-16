// The registries of a host for the example corpus runners (scripts/dsl): the bundled packs, then the built-in layouts.
import { registerBuiltInLayouts } from '@fluxion/layout';
import { basicPack } from '@fluxion/pack-basic';
import { themesCorePack } from '@fluxion/pack-themes-core';
import { type CoreRegistries, createCoreRegistries } from '@fluxion/sdk';

/** Fresh registries as a host has them: the bundled packs, then the built-in layouts. */
export function registries(): CoreRegistries {
  const r = createCoreRegistries();
  for (const pack of [basicPack, themesCorePack]) {
    const done = pack.register(r);
    if (!done.ok) throw new Error(`pack ${pack.id} failed to register: ${done.error.map((d) => d.message).join('; ')}`);
  }
  const layouts = registerBuiltInLayouts(r.layouts);
  if (!layouts.ok) throw new Error('the built-in layouts failed to register');
  return r;
}
