---
'@fluxion/pack-themes-core': minor
'@fluxion/sdk': minor
'@fluxion/theme': minor
---

The `themes-core` pack (FR-THM-003): light, dark, corporate, vibrant, pastel, high-contrast, blueprint and chalkboard, each valid against the full token schema with text and background roles at WCAG AA. The SDK's `definePack` takes `themes` (validated with `validateTheme`, registered as `<pack>:<name>` in the host's `themes` registry) and re-exports `validateTheme`, `contrastRatio`, `LIGHT_THEME`, `REQUIRED_COLOR_ROLES` and `Theme`; `@fluxion/theme` gains `contrastRatio` and `relativeLuminance`.
