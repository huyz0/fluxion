---
'@fluxion/render': minor
'@fluxion/cli': minor
---

Hosts without a canvas measure text with the recorded font metrics (`serverMeasurer`, `createFixedMeasurer`, `FIXED_ADVANCE_EM`) and a fixed advance for any other font; `fluxion render` uses the bundled fonts' metrics and the ones a document embeds, so text is fitted as the studio fits it (FR-TXT-002, ADR-0148).
