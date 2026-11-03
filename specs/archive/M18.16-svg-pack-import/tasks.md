# Delivery

| Row | Deliverable | Qualification |
|---|---|---|
| M18.171 | ADR-0206, this spec, M18.16's refined EARS, completion leg rebound to the format/CLI suites | Independent plan review |
| M18.16 | `fluxion pack-import`, input reader, atomic writer, output schema, corpus/bounds e2e, face-family keying fix | e2e against the built bin + Chromium; schema contract; staged verify |

M18.17 (library import UI) depends on M18.16 and reuses its reader bounds and pack path.
