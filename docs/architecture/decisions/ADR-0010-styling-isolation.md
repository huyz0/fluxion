---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0010 — Tailwind + shadcn/Base UI for editor chrome only; theme tokens + CSS Modules for content

## Context and Problem Statement

Fluxion has two styling worlds:
1. **Editor chrome**: panels, menus, dialogs.
2. **Rendered document content**: screens, shapes, text, and the player UI inside `.flux.html`,
   embeds, static sites and exports.

Content must be themeable at runtime (FR-THM-001..004), portable into single files and host pages
(FR-PRS-009), isolated from host CSS, and small (NFR-SIZE-001). How do we style each world without
one leaking into the other?

## Decision Drivers

- Rendered content must look identical in studio, player, embed, site and export (FR-EDT-010).
- Themes are DTCG tokens switched live, without re-render.
- Embedding in arbitrary pages: no global CSS leaks in either direction.
- Editor productivity and accessibility (NFR-A11Y-001): agent-fluent, accessible primitives.
- No editor dependency in the player.

## Considered Options

1. Tailwind everywhere (editor and content)
2. CSS-in-JS runtime (styled-components/Emotion) everywhere
3. vanilla-extract for content, Tailwind for editor
4. Tailwind v4 + shadcn/ui (Base UI) for editor chrome only; content via theme-token CSS
   custom properties + CSS Modules with `fx-` prefix in `@layer`, Shadow DOM for embeds

## Decision Outcome

Chosen option: **4**.
- **Editor chrome**: Tailwind CSS v4 + shadcn/ui on Base UI. The component code is owned in the
  repo.
- **Content** (`render`, `player`, packs):
  - tokens compile to CSS custom properties (`--fx-color-accent-solid`…) on the screen root;
  - CSS Modules with an `fx-` class prefix inside `@layer fluxion`;
  - SVG uses `fill="var(--fx-…)"`;
  - theme and mode switch by changing an attribute.
- **Embeds**: `<fluxion-player>` mounts in a Shadow DOM. Custom properties still inherit, so host
  pages can theme on purpose.
- Tailwind classes in `render`/`player`/`packs` are forbidden by a lint rule and a bundle check.

### Consequences

- Good, because exported files carry only small token CSS, with no utility framework.
- Good, because Shadow DOM isolation works (Tailwind v4 `@property` registrations do not work in
  shadow roots — another reason to keep it out).
- Good, because theme switching is instant and exporters resolve tokens to literals (PPTX/PDF).
- Bad, because there are two styling systems to learn; component-shape authors must use tokens,
  not Tailwind.
- Bad, because the editor preview frame must not inherit editor styles: content is rendered inside
  its own layer/root with a reset.

### Confirmation

Lint: no Tailwind classes or `@apply` in content packages. The player bundle check finds no
Tailwind or shadcn code. A visual test compares an embed in a hostile host page (aggressive global
CSS) with the standalone player.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Tailwind everywhere | one system | leaks into exported files; `@property` breaks in Shadow DOM; class soup in documents |
| CSS-in-JS runtime | co-location | runtime cost in player; SSR complexity |
| vanilla-extract | typed tokens | build step for every plugin author |
| Split: Tailwind chrome / tokens content | portable, isolated, fast | two systems |

## More Information

Research: `docs/research/05-engineering-stack-and-tooling.md` §7.3;
`docs/research/04-file-format-ai-generation-theming.md` §C.1. Standards:
`../../standards/tech-stack.md`, `../../standards/design-ui.md`.

## Amendments

- 2026-09-28 (ADR-0015, M4.2): content CSS is one string module of `fx-`-prefixed rules in
  `@layer fx.content`, not CSS Modules: Node has no CSS Modules loader, and SSR, the browser and
  export must use byte-identical CSS. The layer is renamed: `@layer fx.content` (the name 04 §2.3
  uses) replaces "`@layer fluxion`" above. The `fx-` prefix and the ban on Tailwind in content are
  unchanged.
- 2026-09-30 (ADR-0029, M6.3): Tailwind v4 and shadcn/Base UI enter the chrome with its first composite widget (M7), importing Tailwind's theme and utilities but never its base reset. Until then the chrome is a scoped `@layer fx.chrome` stylesheet under `.fx-editor`.
