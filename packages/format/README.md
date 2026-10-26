# @fluxion/format

The Fluxion containers: `.flux` zip packages, `.flux.html` pages that carry the player, and the loader, asset pipeline, sanitizers and
journal around them. The format is specified in `specs/format/flux-1.0.md`.

| Layer | Pure | Status |
|---|---|---|
| L2 | yes | M10 — read, write, convert, repair, import images, sanitize; the host passes the hasher and the image codec |

## Public surface

| Area | Exports |
|---|---|
| Package | `writeFlux`, `loadFlux`, `FLUX_FORMAT_VERSION`, `FLUX_MIMETYPE`, `FluxAsset`, `FluxBakes`; the zip codec `readZip`, `writeZip` |
| Page | `writeFluxHtml`, `readFluxHtml`, `FLUX_HTML_MARKER_META`, `FLUX_HTML_MARKER_COMMENT`, `FLUX_HTML_BOOT` |
| Opening | `openDocumentText` (a `.flux.json` or a document's text, with salvage of what can be read), `LoadNote`, `FormatError` |
| Assets | `createMemoryAssetStore`, `selectAssets`, `referencedAssetHashes`, `usedAssetIds`, `usedFontFamilies` |
| Images | `sniffImage`, `importImage` (cap `MAX_IMAGE_SIDE`, limit `MAX_IMPORT_BYTES`), `minifySvg`, `sanitizeSvg`, `inspectSvg`, `sanitizeAsset`, `checkAsset` |
| SVG import | `importSvgShape`, `importSvgBatch`, `createSvgPaintRequest`, `parseSvgPaintRequest`; pure conversion and canonical request validation, with paint observed through a host port |
| Safety | `safeLinkUrl`, `sha256Hex` |
| Journal | `encodeDiff` and the journal entry types for autosave |

```ts
import { loadFlux, sha256Hex, writeFlux, writeFluxHtml } from '@fluxion/format';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const flux = await writeFlux({ document, appVersion: '1.0.0', hasher });
if (flux.ok) {
  const page = await writeFluxHtml({ flux: flux.value, playerScript, title: 'Deck', hasher }); // presents offline
  const back = await loadFlux(flux.value, { hasher }); // never throws
}
```

Architecture: [docs/architecture/08-file-format.md](../../docs/architecture/08-file-format.md).

SVG paint requests require normalized artwork and its exact used faces in hash order.
`createSvgPaintRequest` owns the canonical raster and content identity;
`parseSvgPaintRequest` rejects stale identities or noncanonical dimensions instead
of repairing them. Both return independent data snapshots. These pure checks do
not establish rendered paint, actual font bytes or theme availability; the host
witness remains responsible for those observations (ADR-0189).
