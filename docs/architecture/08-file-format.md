# 08 — File Format & Persistence (`@fluxion/format`)

> Read when: changing what is written to or read from disk, the `.flux` / `.flux.html` /
> `.flux.json` containers, the asset pipeline, save/open/autosave flows, the loader, or anything
> that affects file security or size. Requirements: `10-document-and-file.md` (FR-FIL, FR-AST),
> NFR-SIZE-003..005, NFR-PORT-002/003, NFR-REL-001/002, NFR-SEC-001/002. Research: `research/04`
> §A, §D.1–D.5. Decision: ADR-0003.

## 1. One model, three wrappers

The canonical content is always the record map from 02 plus binary assets. It is wrapped three ways:

| Variant | MIME / ext | Purpose | Opens in |
|---|---|---|---|
| `.flux` | `application/vnd.fluxion+zip` | compact package: storage, exchange, CLI/MCP, AI pipelines (FR-FIL-003) | studio, CLI |
| `.flux.html` | `text/html` | same package + inline player: double-click to present, offline (FR-FIL-001/002) | any browser; studio re-imports |
| `.flux.json` | `application/vnd.fluxion+json` | canonical pretty JSON for diffs, git, tests, clipboard (FR-FIL-005) | studio, CLI |

Conversions are lossless (`fluxion convert`). The `.flux` zip is the **unit of truth**: `.flux.html`
embeds those exact bytes, and `.flux.json` is a deterministic projection of the same entries.

## 2. `.flux` zip layout

```
deck.flux
├── mimetype                          "application/vnd.fluxion+zip" — FIRST entry, stored, no extra field
├── manifest.json                     container metadata + entry hashes + plugin lock
├── document.json                     { "schemaVersion": "1.0", "records": { id → record } }
├── theme/tokens.json                 DTCG 2025.10 token file of the active theme (mirrors the theme record)
├── source/document.flux.yaml         optional: FluxScript the document was compiled from (AI regeneration)
├── assets/<sha256>.<ext>             content-addressed binaries: webp, avif, png, svg, woff2, mp4, lottie…
├── plugins/<id>@<version>/player.js  player bundle of each USED plugin (never the editor bundle)
├── plugins/<id>@<version>/fluxion-plugin.json
├── snapshots/<elementId>.svg|.webp   static fallback of plugin/component elements (FR-CMP-006, FR-EXT-008)
└── preview.webp                      cover thumbnail (≤ 640 px) for pickers, library, OS previews
```

```ts
interface Manifest {
  format: 'fluxion'; formatVersion: '1.0';        // container version (this doc)
  schemaVersion: string;                           // document schema (02 §4)
  app: { name: 'fluxion'; version: string };
  generator?: string;                              // e.g. "fluxion-mcp 1.2 / <model id>"
  title: string; created: string; modified: string; // ISO 8601
  entries: Record<string, { sha256: string; size: number }>; // every entry except mimetype + manifest
  plugins: PluginLock[];                           // mirrors plugin-ref records
  bakes: { routes: boolean; snapshots: boolean };  // what derived data is included (§8)
  source?: string; preview?: string;
}
interface PluginLock { id: string; version: string; sdk: string;
  integrity: `sha256-${string}`; entry: string; trust: 'first-party' | 'trusted' | 'untrusted' }
```

Zip rules (implemented with fflate):
- **Deterministic bytes**: fixed entry order (mimetype, manifest, document, theme, source, assets
  sorted, plugins sorted, snapshots sorted, preview), fixed timestamp (`1980-01-01`), no extra
  fields. The same document produces the same bytes, so hashes and git work.
- **Per-entry method**: deflate (level 6) for JSON/SVG/JS/YAML; **store** for WebP/AVIF/PNG/WOFF2/MP4
  (already compressed).
- Unknown entries from a newer writer are **copied through** on re-save (forward compatibility).

## 3. `.flux.html` structure

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-<boot>'
        'sha256-<player>' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:;
        media-src data: blob:; connect-src 'none'; frame-src blob:; object-src 'none'; base-uri 'none';
        form-action 'none'">
  <meta name="generator" content="fluxion 1.4.0">
  <meta name="fluxion:format" content="1.0">          <!-- re-import marker #1 -->
  <title>How our checkout works</title>
  <style>/* ≤ 2 kB: loading state + noscript layout */</style>
</head>
<body>
  <!-- fluxion:package v1 -->                          <!-- re-import marker #2 (in first 4 kB) -->
  <fluxion-player></fluxion-player>
  <noscript><!-- pre-rendered SVG of screen 1 + "enable JavaScript to present" --></noscript>
  <script type="application/octet-stream" id="fluxion-package"
          data-encoding="base64" data-sha256="…">UEsDBAoAAAAAAA…</script>
  <script type="module" id="fluxion-player">/* player bundle, inline */</script>
  <script type="module" id="fluxion-boot">/* ≈ 1–2 kB bootstrap */</script>
</body>
</html>
```

Bootstrap: read `#fluxion-package` → `Uint8Array.fromBase64` (fallback `atob`) → hand the bytes to
the player. The player reads the zip with fflate and inflates entries with native
`DecompressionStream('deflate-raw')` where available. Plugin bundles are imported from Blob URLs
(`blob:` in `script-src`), so they need no hash in the CSP. Their integrity is checked before import (§7).

- The payload is base64 of the `.flux` zip. The zip is already compressed, so base64 adds 33 % to
  compressed bytes, not to raw JSON.
- **Compact mode** (opt-in after the research 04 §D.9 spike): the player bundle is also stored
  deflated in a second octet-stream block and imported from a Blob URL, saving ~60 % of player
  bytes. The inline-module path stays the fallback because it works from every `file://` origin.
- **Re-import**: the studio detects `.flux.html` by the markers and extracts `#fluxion-package` by
  **text scanning only**. It never executes the file's scripts. The player's "Open in Fluxion"
  button hands the bytes to the studio via `postMessage` (new tab) or a download.
- The player never saves in place. Editing happens in the studio, which rewrites the whole file
  with the current player version.

## 4. `.flux.json` (canonical pretty variant)

```json
{
  "fluxion": "1.0",
  "manifest": { "…": "entries omitted; hashes recomputed on convert" },
  "records": { "doc": { "…": "…" }, "e1": { "…": "…" } },
  "theme": { "…": "DTCG tokens" },
  "source": "flux: 1\n…",
  "assets": { "3f9a…c1": { "mime": "image/webp", "base64": "UklGR…" } },
  "plugins": { "acme.chart@1.4.2": { "manifest": {}, "player": "base64…" } }
}
```

Determinism (byte-identical for identical documents): object keys sorted by code point
recursively, 2-space indent, LF, trailing newline, geometry numbers rounded to 1e-3 (element
`transform` x/y/w/h/rot, free connector ends, waypoints, label offsets, screen `size` and
`viewport`; magnitudes of 1e12 or more are kept, the grid being finer than their precision) and
`-0` → `0`, every other number (unknown fields and plugin data included) written exactly, no
`undefined`/`NaN`. `@fluxion/schema`
`serializeDocument`/`canonicalNumber` is the reference implementation. `--assets=external` writes assets as `<name>.assets/<sha256>.<ext>` next to
the JSON so git diffs stay small.

## 5. Size estimates

Reference: 20 screens × ~15 elements, 2 subset fonts, no photos (NFR-SIZE-003).

| Part | Raw | In `.flux` | In `.flux.html` |
|---|---|---|---|
| document + theme + manifest JSON | ~120 kB | 15–25 kB | 20–33 kB |
| 2 subset WOFF2 fonts (Latin) | — | 60–120 kB | 80–160 kB |
| preview.webp | — | 10–20 kB | 13–27 kB |
| player (React + render + anim + player) | ~400 kB min | — | ≤ 150 kB gzip budget (NFR-SIZE-001); inline ≈ 300–400 kB, compact ≈ 150–200 kB |
| **Total** | | **≈ 90–150 kB** (budget 150 kB) | **≈ 300–450 kB** (budget 450 kB) |

Every 8 photos (WebP ≤ 2560 px) add roughly 0.6–1.2 MB. A fixture test enforces the budgets. Layout
engines are never embedded unless a live-layout container needs one (NFR-SIZE-005).

## 6. Asset pipeline

```
import (drop/paste/picker/URL/FluxScript ref)
  → sniff MIME by magic bytes (never by extension)
  → normalize:  raster → decode, cap longest side 2560 px (FR-AST-002), re-encode WebP q≈0.82
                          (keep the original if smaller or animated, detected from the bytes; AVIF is kept, not encoded, in M10, ADR-0025)
                SVG    → allowlist sanitizer (ADR-0150) → `minifySvg` (keep viewBox; no SVGO, ADR-0025)
                font   → keep full file in session; embedded whole on save (subsetting is later, ADR-0022 amendment M10.3)
                video/Lottie → as-is, size warning > 5 MB (FR-AST-004)
  → sha256 (Hasher port) → asset record { hash, mime, size, w, h, name, source? }
  → bytes in session AssetStore (OPFS in studio, memory in CLI), deduped by hash (FR-FIL-004)
save
  → collect referenced asset hashes (records, theme, component props, snapshots)
  → font subsetting (later, not in M10: ADR-0025): glyphs used in text + a safety range for the document's
    scripts, hb-subset wasm (lazy chunk in studio, npm module in CLI), WOFF2, pin unused variable axes
  → write only referenced assets (unreferenced ones stay in the session store so undo still works)
```

- The raster encoder is `OffscreenCanvas.convertToBlob` in the browser; the CLI keeps images as they are in M10 and a
  wasm encoder follows later (no native dependencies, NFR-PORT-004; ADR-0025).
- The SVG sanitizer rebuilds the file from a tokenizer with an allowlist (ADR-0150). It removes scripts, event
  handlers, `foreignObject`, external `href` and CSS `url()` to non-data targets. The same code
  runs in Node and the browser, so CLI output equals studio output.
- External assets (FR-AST-006): the record keeps `source` URL + `integrity`. "Embed on save" fetches
  the bytes, checks the hash and stores them. The player loads external URLs only if the document
  allows it and the CSP was widened at export.

## 7. Save, open, autosave, recovery

All I/O goes through the `FileIO` port (03 §7). The studio adapter uses the browser APIs below; the
CLI uses `node:fs`.

| Flow | Chromium | Firefox / Safari |
|---|---|---|
| Open | `showOpenFilePicker`, drag-drop, `?src=` URL (fetch, CORS), paste | `<input type=file>`, drag-drop, `?src=`, paste |
| Save | `FileSystemFileHandle.createWritable()` — the browser writes a swap file and commits on `close()` (atomic, NFR-REL-001) | download via `<a download>` ("Save" = new copy) |
| Recents | handles stored in IndexedDB + thumbnail (FR-FIL-008) | library entries backed by autosave |

Sniffing on open: zip magic + `mimetype` entry → `.flux`; HTML markers → `.flux.html`; JSON with
top-level `fluxion` → `.flux.json`; YAML with `flux:` → compile FluxScript; PNG `iTXt` chunk
`fluxion` / SVG `<metadata>` → editable exports.

**Autosave** (FR-FIL-007): every store `Diff` is journaled to IndexedDB (per-record puts, debounced
≤ 2 s; budget ≤ 5 s). Asset bytes live in OPFS by hash. **Version snapshots**: on each explicit save
and every 10 minutes of editing, a full `.flux` is written to OPFS `versions/<docId>/<iso>.flux`;
the last 20 are kept. **Recovery**: on start-up, if a journal revision is newer than the last saved
revision, the studio offers "Recover unsaved changes" and shows a preview.

## 8. Baked vs derived

| Data | In file? | Why |
|---|---|---|
| Element transforms, including laid-out positions | **baked** (always) | player never runs layout (NFR-SIZE-005) |
| Resolved theme styles | derived | tokens stay editable; CSS variables at runtime |
| Connector routes | derived; **optional route cache** in `document.json` `meta.routeCache` keyed by input fingerprint | exporters and no-JS site output; ignored if the fingerprint mismatches |
| Anchor positions, text metrics, animation state | derived | recomputed from model (02 §6) |
| Component/plugin snapshots | **baked** in `snapshots/` | missing or untrusted plugins still render |
| Preview thumbnail | **baked** | pickers, library |
| FluxScript source | optional | regeneration and diff for AI |

## 9. Loader robustness (FR-FIL-009, NFR-REL-002)

```ts
interface LoadResult {
  status: 'ok' | 'repaired' | 'salvaged' | 'failed';
  doc?: DocSnapshot; manifest?: Manifest;
  diagnostics: Diagnostic[];          // 02 §5
  readOnly: boolean;                  // newer MAJOR format/schema: view only, offer upgrade
}
function load(bytes: Uint8Array, ctx: LoadContext): Promise<LoadResult>; // never throws
```

Pipeline: **sniff → unpack → verify → parse → migrate → validate → repair → salvage**.
- *Unpack*: if the central directory is damaged, scan local headers. Limits: ≤ 10 000 entries,
  ≤ 512 MB uncompressed, compression ratio ≤ 200:1 (zip-bomb guard). Reject `..`, absolute and
  duplicate paths.
- *Verify*: entry sha256 vs manifest. A mismatch on data → warning. A mismatch on a plugin → that
  plugin is blocked and its snapshots are used.
- *Parse*: if `document.json` is truncated, a salvage parser recovers every complete record.
- *Migrate* (02 §4) → *validate* → *repair* (dangling bindings become free ends, missing indexes are
  appended, unknown tokens fall back). *Salvage* drops records that are still invalid, keeps
  every screen that renders and lists what was dropped.
- Fuzzed with fast-check on 10 000 random and corrupted inputs; no uncaught error is allowed.

## 10. Security

- Every opened file is untrusted (NFR-SEC-001): rich text is rebuilt from the schema'd JSON (never
  HTML strings); SVG goes through the sanitizer; URLs allow `https:`, `http:`, `mailto:` and
  in-document `#` only; no `eval`/`new Function` anywhere.
- `.flux.html` ships the strict CSP of §3 (NFR-SEC-002): no remote script, `connect-src 'none'`
  unless the author enables network permissions for a plugin, which widens `connect-src` to its
  declared hosts only.
- Plugin bundles are checked against `PluginLock.integrity` before `import()` and run under the
  trust tier from 09 (FR-FIL-010). Signed publishers come later (FR-PKG-005).
- The studio enforces Trusted Types. AI provider keys and session state are never serialized into
  files (NFR-SEC-004, test scans saved outputs).
- Encrypted export (FR-FIL-011, R8) will wrap the whole zip as `encrypted.bin` (AES-GCM,
  Argon2id/PBKDF2 key) inside the same HTML shell.

## 11. Versioning

| Version | Where | Bumps when |
|---|---|---|
| `formatVersion` | `manifest.json`, HTML meta | container layout changes (entries, encoding) |
| `schemaVersion` | `document.json` | record schema changes (02 §4) |
| plugin `version` | `PluginLock`, `plugin-ref` | plugin props schema; plugin supplies migrations |

Policy (NFR-PORT-003): minor = additive. Older readers preserve unknown fields and entries. Major =
converter + ADR; older readers open newer-major files read-only. Every released `formatVersion`
keeps golden `.flux`, `.flux.html` and `.flux.json` fixtures in `packages/format/__fixtures__/`,
and CI loads, migrates and round-trips all of them.
