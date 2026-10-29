---
"@fluxion/cli": minor
"@fluxion/format": minor
---

`fluxion pack-import <folder | file.zip> -o <out-dir>` (ADR-0206) turns a folder or ZIP of SVGs into one checked shape pack directory, written atomically, or nothing: ids from file names, categories from folders, rights declared per member by `--credits <file.json>` or the one-credit flags, the batch bounds checked before anything is read, every member converted under the shipped paint witness, text drawn in fonts-core's Inter making a 1.1 pack. Its `--json` reply is `schemas/pack-import.output.json`. `importedShapePack` takes optional scoped `credits` (each covering its `definitionIds`, together every entry exactly once) and returns the canonical `files` map; faces of one font are keyed case-insensitively by family. Migration: none.
