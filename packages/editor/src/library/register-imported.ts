// Atomic registration of converted import definitions (FR-LIB-005, FR-LIB-006): all or nothing, in a namespace that
// nothing else holds, so an import never mixes with an installed pack or a previous import of the same name.
import type { Disposable, Registry, ShapeDef } from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';

const problem = (message: string): Diagnostic => ({ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message });

/** Register every definition under `source`; refuses an empty set, a held namespace, and rolls back on any refusal. */
export function registerImported(registry: Registry<string, ShapeDef>, defs: readonly ShapeDef[], source: string): Result<Disposable, readonly Diagnostic[]> {
  const first = defs[0];
  if (first === undefined) return err([problem('no entry could be imported')]);
  const namespace = `${first.id.split(':')[0]}:`;
  if (registry.list().some(([id]) => id.startsWith(namespace))) return err([problem(`namespace ${namespace.slice(0, -1)} is already registered`)]);
  const done: Disposable[] = [];
  const dispose = () => {
    for (const d of done) d.dispose();
  };
  for (const def of defs) {
    const added = registry.register(def.id, def, source);
    if (!added.ok) {
      dispose();
      return err([added.error]);
    }
    done.push(added.value);
  }
  return ok({ dispose });
}
