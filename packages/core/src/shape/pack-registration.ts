import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import type { Disposable, Registry } from '../registry.js';
import type { ShapePackLicensePolicy, ShapePackSubset } from './pack-types.js';
import { parseShapePackSubset } from './pack-validation.js';
import type { ShapeDef } from './shape-def.js';

const problem = (message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: '/shapePacks', message });

function preflight(
  registry: Registry<string, ShapeDef>,
  inputs: readonly unknown[],
  policy: ShapePackLicensePolicy,
): Result<readonly ShapePackSubset[], readonly Diagnostic[]> {
  const packs: ShapePackSubset[] = [];
  const namespaces = new Set<string>();
  const existing = registry.list();
  for (const input of inputs) {
    const parsed = parseShapePackSubset(input, policy);
    if (!parsed.ok) return parsed;
    const pack = parsed.value;
    if (namespaces.has(pack.id)) return err([problem(`duplicate saved namespace ${pack.id}`)]);
    if (existing.some(([id]) => id.startsWith(`${pack.id}:`) || registry.source(id) === pack.id))
      return err([problem(`namespace ${pack.id} is already registered; installed and saved versions cannot be mixed`)]);
    namespaces.add(pack.id);
    packs.push(pack);
  }
  return ok(packs);
}

/**
 * Validate and register saved geometry in a document-scoped registry under an explicit policy.
 * Existing namespaces are refused even for disjoint IDs or the same source; versions are never
 * inferred from registry ownership. Failure rolls back only newly inserted definitions. Hosts
 * must not expose the document registry until this synchronous operation succeeds.
 * @public
 */
export function registerShapePackSubsets(
  registry: Registry<string, ShapeDef>,
  inputs: readonly unknown[],
  policy: ShapePackLicensePolicy,
): Result<Disposable, readonly Diagnostic[]> {
  const inserted: Disposable[] = [];
  const dispose = () => {
    for (const item of inserted) item.dispose();
  };
  try {
    const checked = preflight(registry, inputs, policy);
    if (!checked.ok) return checked;
    for (const pack of checked.value) {
      for (const def of pack.definitions) {
        const added = registry.register(def.id, def, pack.id);
        if (!added.ok) {
          dispose();
          return err([added.error]);
        }
        inserted.push(added.value);
      }
    }
    return ok({ dispose });
  } catch {
    dispose();
    return err([problem('saved shape registration failed')]);
  }
}
