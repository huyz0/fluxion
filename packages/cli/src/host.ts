// The CLI as a host (ADR-0017): core registries with the first-party packs it bundles, registered
// through the SDK like any plugin. The renderer draws shapes from them (M5.9), and routes connectors with
// its routers, which hold a pack's connector types too (M18.252).
import { registerBuiltInLayouts, registerBuiltInTemplates } from '@fluxion/layout';
import { basicPack } from '@fluxion/pack-basic';
import { registerBuiltinMarkers } from '@fluxion/render';
import { registerBuiltinRouters, registerConnectorDefs } from '@fluxion/routing';
import type { Diagnostic } from '@fluxion/schema';
import { type CoreRegistries, createCoreRegistries, type Pack } from '@fluxion/sdk';

/**
 * The packs every command loads.
 *
 * @public
 */
export const BUNDLED_PACKS: readonly Pack[] = [basicPack];

/** Routing's registry of routers. */
type Routers = Parameters<typeof registerConnectorDefs>[0];

/** The host's routers as routing's registry: core keeps them opaque, and routing's routers are what they hold. */
export const hostRouters = (registries: CoreRegistries): Routers => registries.routers as unknown as Routers;

/** The problems of registering `pack`'s connector types into `routers` (none when it has none). */
function packConnectorProblems(routers: Routers, pack: Pack): readonly Diagnostic[] {
  if (pack.connectors === undefined) return [];
  const r = registerConnectorDefs(routers, { format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: pack.connectors }, pack.id);
  return r.ok ? [] : r.error.map((d) => ({ ...d, path: `/connectors${d.path.replace(/^\/definitions/, '')}`, message: `pack "${pack.id}": ${d.message}` }));
}

/**
 * Fresh core registries holding `packs` (their connector types in the routers), or the diagnostics of every pack that failed to register
 * (a bundled pack failing is the CLI's own fault: callers report it as internal).
 *
 * @public
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
    registerBuiltinRouters(hostRouters(registries)),
    registerBuiltinMarkers(registries.markers as unknown as Parameters<typeof registerBuiltinMarkers>[0]),
  ];
  const templates = registerBuiltInTemplates(registries.templates);
  const problems: Diagnostic[] = [
    ...builtIns.flatMap((r) => (r.ok ? [] : [r.error])),
    ...(templates.ok ? [] : [{ code: 'FLX_PACK_INVALID' as const, severity: 'error' as const, path: '/templates', message: templates.message }]),
    ...packs.flatMap((pack) => {
      const r = pack.register(registries);
      return r.ok ? [] : r.error.map((d) => ({ ...d, message: `pack "${pack.id}": ${d.message}` }));
    }),
    // a pack's connector types go to the routers, after the built-in routers they decorate, all or none (FR-CON-010)
    ...packs.flatMap((pack) => packConnectorProblems(hostRouters(registries), pack)),
  ];
  return { registries, problems };
}
