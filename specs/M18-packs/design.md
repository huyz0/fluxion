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
Remaining ADR-0049–0051 decisions still precede their implementations.
