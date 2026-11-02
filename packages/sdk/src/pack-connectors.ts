// A pack's connector types (FR-CON-010, ADR-0048 amendments M18.38 and M18.111): `connectors.json` read as bounded,
// strict UTF-8 JSON and validated as `fluxion-connector-defs`, a separate envelope beside the shape index. The host
// registers the result in its routers with routing's `registerConnectorDefs`, all or none.
import { type ConnectorDef, parseConnectorDefs } from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { decode, freezeJson, problem, snapshot } from './pack-bytes.js';

/**
 * The connector definitions of pack `pack` from the bytes of its `connectors.json`, deeply frozen; at most `maxBytes`.
 * A file over the cap, not UTF-8 JSON or not a valid `fluxion-connector-defs` envelope (ids in namespace `pack`,
 * each once) is refused whole with `FLX_PACK_INVALID` diagnostics.
 *
 * @public
 */
export function loadPackConnectors(bytes: Uint8Array, pack: string, maxBytes: number): Result<readonly ConnectorDef[], readonly Diagnostic[]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return err(problem([], 'byte limit must be a positive safe integer'));
  const owned = snapshot(bytes, maxBytes);
  if (!owned) return err(problem([], 'connectors.json exceeds the byte limit or is not bytes'));
  let input: unknown;
  try {
    input = decode(owned);
  } catch {
    return err(problem([], 'connectors.json is not UTF-8 JSON'));
  }
  const parsed = parseConnectorDefs(input, pack);
  return parsed.ok ? ok(freezeJson(parsed.value)) : parsed;
}
