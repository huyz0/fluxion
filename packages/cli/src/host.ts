// The CLI as a host (ADR-0017): core registries with the first-party packs it bundles, registered
// through the SDK like any plugin. The renderer draws shapes from them (M5.9).
import { registerBuiltInLayouts } from '@fluxion/layout';
import { basicPack } from '@fluxion/pack-basic';
import { registerBuiltinMarkers } from '@fluxion/render';
import { registerBuiltinRouters } from '@fluxion/routing';
import type { Diagnostic } from '@fluxion/schema';
import { type CoreRegistries, createCoreRegistries, type Pack } from '@fluxion/sdk';

/** The packs every command loads. */
export const BUNDLED_PACKS: readonly Pack[] = [basicPack];

/**
 * Fresh core registries holding `packs`, or the diagnostics of every pack that failed to register
 * (a bundled pack failing is the CLI's own fault: callers report it as internal).
 */
export function hostRegistries(
  packs: readonly Pack[] = BUNDLED_PACKS,
  options: { readonly requireDescribe?: boolean } = {},
): { registries: CoreRegistries; problems: readonly Diagnostic[] } {
  const registries = createCoreRegistries(options);
  // the built-in layouts, route types and markers, which the catalog lists beside the packs' shapes and markers (FR-AI-002)
  // (the opaque `routers` and `markers` registries of core hold what the routing and render packages know they are)
  const builtIns = [
    registerBuiltInLayouts(registries.layouts),
    registerBuiltinRouters(registries.routers as unknown as Parameters<typeof registerBuiltinRouters>[0]),
    registerBuiltinMarkers(registries.markers as unknown as Parameters<typeof registerBuiltinMarkers>[0]),
  ];
  const problems = [
    ...builtIns.flatMap((r) => (r.ok ? [] : [r.error])),
    ...packs.flatMap((pack) => {
      const r = pack.register(registries);
      return r.ok ? [] : r.error.map((d) => ({ ...d, message: `pack "${pack.id}": ${d.message}` }));
    }),
  ];
  return { registries, problems };
}
