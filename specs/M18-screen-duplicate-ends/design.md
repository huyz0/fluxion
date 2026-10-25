# Design and validation

Extend `screen.duplicate` with optional `freeEnds: Record<connectorId, {source?: Point, target?: Point}>`.
Each point has finite numeric x/y. The map is keyed by source IDs, not caller-created copy IDs.
Classify omitted bindings using the same selection used to copy records. Require geometry only
for selected connectors whose endpoint binding is omitted; an outside connector bound to a selected
shape is not copied and requires no point. Retain existing free endpoints and copied internal bindings.
Preflight all required points before the write; patch only the necessary free end on its copied record.

Missing required geometry returns COMMAND_ARGS / FLX_COMMAND_ARGS at
`/args/freeEnds/<connector>/<end>` with nonempty detail. Nonfinite or malformed supplied points
use the argument schema's offending coordinate path. Do not validate a partial transaction and
then guess coordinates. Unused well-formed map entries have no effect.

Navigator `duplicateArgs` takes an optional endpoint reader; the screens tab can construct it
from its existing store/render registries and routing resolver. Gather only required outside-bound
ends. No routing import into core or new dependency. Preserve the old call signature through an
optional parameter; update public API snapshots only if an exported surface changes.

Tests use real stores and routing fixtures: both outside directions; mixed internal, external and
already-free ends; non-centre points; no source/outside changes; record order; one undo step and exact
redo. Missing map/required end and nonfinite coordinates refuse atomically with exact diagnostics.
Legacy internal-only argument fixtures remain. Navigator/browser integration must exercise the
actual route point and successful screen switch, not a mocked success result. If routing cannot
resolve a required end, preserve the explicit refusal and source state; never guess a centre.

Alternatives are recorded in ADR-0175. Scope excludes animation-copy changes, binding selection
expansion, file migrations and threshold changes. M18.64 archives this spec after implementation;
M18.10 continues to require complete current-revision mutation evidence and unchanged package floors.
