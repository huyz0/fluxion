// The CLI as a host (ADR-0017): core registries with the first-party packs it bundles, registered
// through the SDK like any plugin. The renderer draws shapes from them (M5.9).
import { basicPack } from '@fluxion/pack-basic';
import type { Diagnostic } from '@fluxion/schema';
import { type CoreRegistries, createCoreRegistries, type Pack } from '@fluxion/sdk';

/** The packs every command loads. */
export const BUNDLED_PACKS: readonly Pack[] = [basicPack];

/**
 * Fresh core registries holding `packs`, or the diagnostics of every pack that failed to register
 * (a bundled pack failing is the CLI's own fault: callers report it as internal).
 */
export function hostRegistries(packs: readonly Pack[] = BUNDLED_PACKS): { registries: CoreRegistries; problems: readonly Diagnostic[] } {
  const registries = createCoreRegistries();
  const problems = packs.flatMap((pack) => {
    const r = pack.register(registries);
    return r.ok ? [] : r.error.map((d) => ({ ...d, message: `pack "${pack.id}": ${d.message}` }));
  });
  return { registries, problems };
}
