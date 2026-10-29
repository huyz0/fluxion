---
"@fluxion/editor": minor
---

The library panel imports SVG libraries (M18.176): a host that passes `libraryImporter` to `EditorRoot` gets **Import SVG…**, whose `LibraryImportDialog` takes SVG files or one ZIP, the pack's namespace, version and name, and its rights (a credits file, or one original or upstream credit with a content license), converts it, offers its literal colors for mapping to theme tokens, and registers the final pack, naming each refusal by member path. `LibraryImporter` and `LibraryImportRequest` are the host's contract. Migration: none.
