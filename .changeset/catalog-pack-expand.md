---
"@fluxion/cli": minor
"@fluxion/mcp": minor
---

`fluxion catalog --pack <id>` and MCP `list_catalog({ pack })` return one pack's catalog in full, for a host that lists packs summarized (ADR-0212). `catalogText` takes an optional `CatalogTextOptions` (`{ pack }`), and both replies carry the pack they listed. An unregistered id is refused with `FLX_CLI_USAGE` naming the registered packs; an empty one is refused.
