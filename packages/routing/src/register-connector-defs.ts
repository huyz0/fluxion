// Registering a pack's connector types (FR-CON-010, ADR-0048 amendment M18.111): each definition of a
// `connectors.json` becomes a decorated router in `routers` under its id, all of them or none. Every problem is
// found before anything is registered, so a refused file leaves the registry as it was.
import { type ConnectorDef, type Disposable, describeOf, parseConnectorDefs, type Registry } from '@fluxion/core';
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { connectorDefRouter, type DecoratedRouter } from './decorate.js';
import type { Router } from './router.js';

/** The problems of putting `def` (at `/definitions/<i>`) into `routers` for `pack`, before anything is registered. */
function defProblems(routers: Registry<string, Router>, def: ConnectorDef, i: number, pack: string): readonly Diagnostic[] {
  const holder = routers.source(def.id);
  if (holder !== undefined && holder !== pack)
    return [
      {
        code: 'FLX_REGISTRY_DUPLICATE',
        severity: 'error',
        path: jsonPointer(['definitions', i, 'id']),
        message: `"${def.id}" is already registered in ${routers.name} by ${holder}`,
      },
    ];
  // the catalog line a router registry may insist on (FR-AI-002): checked here so registering cannot fail half-way
  if (def.describe !== undefined && describeOf(def) === undefined)
    return [
      {
        code: 'FLX_PACK_INVALID',
        severity: 'error',
        path: jsonPointer(['definitions', i, 'describe']),
        message: 'describe must be one line of at most 160 characters',
      },
    ];
  if (routers.get(def.router) === undefined)
    return [
      { code: 'FLX_PACK_INVALID', severity: 'error', path: jsonPointer(['definitions', i, 'router']), message: `router "${def.router}" is not registered` },
    ];
  return [];
}

/**
 * Validate the parsed `connectors.json` of pack `pack` (`parseConnectorDefs`) and register each definition in
 * `routers` under its id as a decorated router over its built-in base (`connectorDefRouter`), source `pack`. All are
 * registered, or none and every problem: `FLX_PACK_INVALID` for the file or a base router that is not registered,
 * `FLX_REGISTRY_DUPLICATE` for an id another source holds. A `describe` must be one catalog line (`describeOf`), so a
 * registry with `requireDescribe` cannot refuse a type half-way. Disposing removes them all. The same pack registering
 * again replaces its types id by id; a type the newer file drops stays until the earlier result is disposed.
 *
 * @public
 */
export function registerConnectorDefs(routers: Registry<string, Router>, input: unknown, pack: string): Result<Disposable, readonly Diagnostic[]> {
  const parsed = parseConnectorDefs(input, pack);
  if (!parsed.ok) return parsed;
  const problems = parsed.value.flatMap((def, i) => defProblems(routers, def, i, pack));
  if (problems.length > 0) return err(problems);
  const done = parsed.value.map((def) => {
    const r = routers.register(def.id, connectorDefRouter(def, routers) as DecoratedRouter, pack);
    // tzap disable next-line ConditionalExpression,BlockStatement,StringLiteral: refused only for another source's key or a describe line, both checked above
    if (!r.ok) throw new Error(`pack ${pack}: ${r.error.message}`);
    return r.value;
  });
  return ok({
    dispose: () => {
      for (const d of done) d.dispose();
    },
  });
}
