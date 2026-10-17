// The outline fixture of the Markdown importer, as a string: dsl sources import no `node:fs`.

/** A deck outline: title slide, a bullet tree, an ordered chain, a rule, a mermaid diagram and a code fence. */
export const OUTLINE: string = `# Launch plan

Why we ship in March.

## Goals

- Grow signups
  - Referral programme
  - Pricing page
- Cut churn

## Steps

1. Build
2. Review
3. Ship

---

## Architecture

\`\`\`mermaid
flowchart LR
  web[Web] --> api[API]
  api --> db[(DB)]
\`\`\`

## Snippet

\`\`\`sh
pnpm build
\`\`\`

<div>raw</div>
`;
