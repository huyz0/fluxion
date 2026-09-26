---
title: Getting started
description: Set up the Fluxion repository and run its gates.
---

```sh
pnpm i
pnpm run setup
pnpm verify
```

`pnpm run setup` installs the git hooks and the browser used by the component tests;
`pnpm verify` runs the full gate ladder that CI runs.
