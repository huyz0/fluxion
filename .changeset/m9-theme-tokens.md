---
'@fluxion/theme': minor
'@fluxion/schema': minor
'@fluxion/cli': minor
---

The full token model (ADR-0152): `validateTheme` and `REQUIRED_COLOR_ROLES` check a theme's colour roles, the type of each token group and its aliases, with a JSON pointer per problem; colour tokens may alias another token (`followColor` follows the chain and reports an unknown link, a non-colour and a cycle); shadow, duration and cubic-bezier tokens; the light theme gains shadows and motion. The diagnostic `FLX_TOKEN_CYCLE` joins the catalogue, so it is also in the `--json` output schemas of `fluxion`, `render` and `validate` (an added value of the diagnostic code list).
