# Design boundaries and decisions

Reuse core ShapeDef validation, the editor library index/search/insert flow and the
format resource model. Decide precise versioned contracts in ADR-0048 before extending
schemas; used declarative definitions are distinct from M27 executable plugins. The
current schema version is 1.7 and existing files must remain readable.

ADR-0049 defines sanitizer, bounded archive/XML decoding and explicit fallback diagnostics.
ADR-0050 preserves current license posture and specifies used-pack attribution.
ADR-0051 chooses a font engine only after primary-source and license review, then defines
WOFF2/glyph closure, layout fingerprint and failures. These decisions precede their code.

Rejected approaches: eager geometry loading violates FR-LIB-009; embedding entire packs
violates used-only persistence; dropping failed imports silently cannot establish the
90 percent draw.io fixture metric; reusing runtime plugin persistence conflates M18/M27.

Risks: malformed input, incompatible definition IDs, font shaping closure, archive bombs,
large pack catalogs and visual baseline portability. Use real fixture round-trips,
all-definition goldens, three current browsers and independent reviews. Thresholds and
zero retries remain unchanged except the explicitly authorized circular timing target.

## Recorded decisions

ADR-0048 selects a metadata index plus hashed category files, reusing core validation
and SDK registration. Used-only canonical bundles have a data-only manifest-lock variant;
M18.14 must prove offline rendering and old-reader preservation before shipping it.
ADR-0049 selects checked inert paint separate from the routing outline, shared sanitizer
policy and bounded existing ZIP/DEFLATE decoding. Direct pack input receives the same
paint validation. Fixture sources/counts are pinned before converter implementation;
unsupported entries remain in each draw.io library's denominator. M18.45–47 isolate
fixture qualification, the behavior-preserving refactor and the artwork API/renderer.
ADR-0050 preserves code/content/font policy boundaries and adds source-scoped credits.
Every used subset retains applicable notices, with offline player rendering; a wrapper's
license cannot erase source rights. Existing code-only license checks are insufficient.
ADR-0051 selects direct HarfBuzz subset WASM and bounded standalone Google WOFF2.
M18.48 qualifies reproducible assets/CSP before M18.39 integrates them; source notices,
RFN fallback, deterministic output, closure and offline save behavior remain mandatory.

ADR-0171 keeps the unchanged circular-500 fixture and 2000 ms target, accepting only a
valid measured timing overrun as advisory. Process/report failures still fail. Other
layout limits and circular correctness remain blocking; required M18 constants are
60000 font bytes, 4 SVG anchors and 90 percent draw.io import, without exceptions.

## Mutation execution completeness

ADR-0173 adds whole-source-file groups after the package-only DSL diagnostic exceeded the
existing timeout. M18.52 partitions the independent complete inventory, preserves all tests
and raw engine reports, and derives package scores only after every group validates. Missing,
duplicate, failed or incomplete evidence fails; no test, mutator, floor or timeout is relaxed.
M18.10 wires and qualifies the existing nightly workflow. Diagnostic timings are not hosted
qualification, and a partial-source score is not a whole-package score.

### Nightly orchestration and evidence

M18.53 implements the orchestration portion of ADR-0173; M18.10 remains the actual
qualification task. A plan job collects the full clean-checkout inventory and a deterministic
matrix. Partition jobs retain all test projects, fail-fast=false, the existing 60-minute
timeout and zero retries. An always-running aggregate job validates the complete artifact
set and fresh checkout manifest before deriving package scores. Existing raw reports and
failure artifacts remain available; no workflow permissions are expanded.

The aggregate emits a bounded, escaped derived evidence notice through normal check
annotations, containing its revision, runner/manifest identity, complete partition IDs and
package counts/scores/floors. A read-only gate validates live terminal plan, partition and
aggregate jobs, exact head SHA, expected partition set, complete scores and current code/final
review ancestry. Failed, skipped, stale, missing or malformed evidence fails closed. Tests
use explicit fixtures and deliberate failures; they cannot qualify nightly execution.

Only new same-run mutation artifacts are downloaded inside the workflow for aggregation.
This does not retrieve previously denied logs. Current-revision qualification is recorded
only after a real successful execution; existing report/issue behavior is retained.
