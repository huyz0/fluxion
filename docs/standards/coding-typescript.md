# Coding — TypeScript & React

> Read when: writing or reviewing any `.ts`/`.tsx` file. Structure and file sizes are in
> `code-structure.md`; performance rules in `performance.md`.
> Related: [security.md](security.md), [design-ui.md](design-ui.md).

Every rule names its gate. "Biome" means the rule is configured in `biome.json` and runs in
`pnpm verify:fast`; warnings are errors.

## 1. Compiler settings

`tsconfig.base.json` is shared by every package; packages may add, never relax.

| Flag | Why |
|---|---|
| `strict` | baseline |
| `noUncheckedIndexedAccess` | `map[key]` and `arr[i]` are `T \| undefined` — handles missing records |
| `exactOptionalPropertyTypes` | `{ a?: string }` ≠ `{ a: string \| undefined }`; matters for patches and diffs |
| `isolatedDeclarations` | every export carries an explicit type; fast `.d.ts`; agents see contracts |
| `verbatimModuleSyntax` | `import type` is explicit; no accidental runtime imports |
| `erasableSyntaxOnly` | no enums, namespaces, parameter properties — plain JS with types |
| `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables` | cheap bug catchers |
| `module: "preserve"`, `moduleResolution: "bundler"`, `types: []` | TS 7-clean; no `baseUrl`, no `outFile` |

1. **Do not weaken flags** in a package tsconfig. → `check-drift`
2. **`@ts-ignore` is banned; `@ts-expect-error` needs a reason.** → Biome

## 2. Naming

| Thing | Style | Example |
|---|---|---|
| Types, components, classes | PascalCase | `ShapeRecord`, `ScreenView` |
| Functions, variables | camelCase, verb-first for functions | `resolveStyle`, `routeConnector` |
| Constants objects | camelCase or PascalCase for `as const` maps | `EffectKind` |
| Record type tags | kebab or dotted string literals | `"shape"`, `"acme.chart"` |
| Booleans | `is/has/can/should` prefix | `isSelected` |
| Signals | `$` suffix | `record$`, `selection$` |
| Hooks | `use` prefix | `useRecord` |
| Files | kebab-case | `route-orthogonal.ts` |

3. **No abbreviations beyond the glossary** (`id`, `el`, `tx`, `ctx`, `px`). → no gate — judgement

## 3. Types

4. **`type` by default; `interface` only for ports and plugin contracts** that callers implement
   or extend. → no gate — judgement
5. **Records are discriminated unions on `type`**; switches over them are exhaustive via
   `assertNever`. → TS + Biome `useExhaustiveSwitchCases`

```ts
// ✅
type ElementRecord = ShapeRecord | ConnectorRecord | GroupRecord;
function boundsOf(el: ElementRecord): Box {
  switch (el.type) {
    case "shape": return shapeBounds(el);
    case "connector": return connectorBounds(el);
    case "group": return groupBounds(el);
    default: return assertNever(el);
  }
}
```

6. **No `enum`** (blocked by `erasableSyntaxOnly`). Use a const object + derived union. → TS

```ts
// ✅
export const Align = { Start: "start", Center: "center", End: "end" } as const;
export type Align = (typeof Align)[keyof typeof Align];
// ❌ enum Align { Start, Center, End }
```

7. **Schema is the source of truth**: record types are `z.infer` of the Zod schema in `schema`,
   never hand-duplicated. → review + `check-api`
8. **Branded IDs** (`ShapeId`, `ScreenId`) — never pass a bare `string` where an ID is meant. → TS
9. **Accept `unknown` at boundaries, parse with Zod, then trust the type.** No `as` casts on
   external data. → Biome + review

## 4. Errors

10. **Expected failures are values, not exceptions.** Functions that can fail for normal reasons
    (invalid input, missing record, unsupported feature) return `Result<T, FluxError>`. →
    review + `check-api` (exported signatures)
11. **Never throw across a package boundary for an expected failure.** `throw` is reserved for
    programmer errors (broken invariants) and is caught at the app edge. → review
12. **`FluxError` has a stable `code`** (`"FORMAT_ZIP_CORRUPT"`, `"SCHEMA_INVALID"`), a
    developer message, optional `path` and `cause`. Codes are part of the public API and listed
    in `schema/src/errors.ts`. → `check-api`

```ts
// ✅
export function readFlux(bytes: Uint8Array): Result<FluxDocument, FluxError> {
  const zip = unzip(bytes);
  if (!zip.ok) return err({ code: "FORMAT_ZIP_CORRUPT", message: zip.error.message });
  return parseDocument(zip.value);
}
// ❌ throw new Error("bad zip")  — callers can't tell expected from fatal
```

13. **Catch `unknown`, narrow, and never swallow.** An empty `catch` is a bug. → Biome

## 5. Immutability and purity

14. **Records are immutable**: `readonly` fields, `ReadonlyArray`, updates produce new objects.
    Mutation happens only inside `core` transactions. → TS + review
15. **Pure packages** (`schema`, `geometry`, `core`, `theme`, `layout`, `routing`, `anim`,
    `format`, `dsl`) use no DOM, timers, `Date.now`, `Math.random`, `fetch` or `node:*`. →
    Biome `noRestrictedGlobals` + `check-layering`
16. **Effects come through ports**: `Clock`, `Random`, `TextMeasurer`, `FileIO`, injected by the
    caller; tests pass fakes. → `check-layering`

```ts
// ✅
export function sampleTimeline(tl: Timeline, clock: Clock): Frame { return evaluate(tl, clock.now()); }
// ❌ export function sampleTimeline(tl: Timeline): Frame { return evaluate(tl, performance.now()); }
```

## 6. React

17. **Function components, named exports, props typed as `type XProps`.** → Biome
18. **No business logic in components**: components read signals/stores, call commands, render.
    Calculations live in pure functions next to them and are unit-tested. → review
19. **Hooks rules and React Compiler compatibility**: no conditional hooks, no mutating props or
    values read during render, no reading refs in render. → Biome `useHookAtTopLevel` +
    compiler bail-out report in CI
20. **No `useMemo`/`useCallback`/`memo` by hand without a profile** showing the gain; the
    compiler memoises. → review
21. **Document data enters components via `useRecord(id)` / `useValue(signal$)`**, not by
    passing whole documents down. Editor UI state via Zustand selectors. → review
22. **User-visible strings go through Lingui** (`<Trans>`, `t`). → Lingui lint (NFR-I18N-001)

## 7. Signals

23. **One signal per record; derive with `computed`**, never copy derived values into records. →
    review (architecture overview §3: derived data is computed, not stored)
24. **Signals are read in `core` queries or React hooks**, not in arbitrary utility functions,
    so dependencies stay visible. → review
25. **Writes go through commands/transactions only**; no direct `signal.set` from UI. →
    `check-layering` (`core` internals not exported)

## 8. Async

26. **No floating promises**: every promise is awaited, returned, or explicitly `void`ed with a
    comment. → Biome `noFloatingPromises` (approximate) + review
27. **Cancellable work takes an `AbortSignal`** (layout, routing, AI calls, file reads). → review
28. **Workers talk via typed messages** defined in the owning package. → TS

## 9. Comments and TSDoc

29. **Every exported symbol has TSDoc** (one sentence + `@param`/`@returns` when not obvious,
    `@example` for SDK). → `check-api` (API Extractor `ae-missing-release-tag`, undocumented)
30. **Comments explain why, not what.** Reference requirement IDs (`// FR-EDT-010`) where a rule
    comes from a spec. → no gate — judgement

## 10. Forbidden

| Pattern | Use instead | Gate |
|---|---|---|
| `any` | `unknown` + narrowing; allowlisted adapters only | Biome `noExplicitAny` |
| `x!` non-null assertion | narrow, or `invariant(x)` | Biome `noNonNullAssertion` |
| `export default` | named export | Biome `noDefaultExport` |
| Deep barrel re-exports (`export *` below `src/index.ts`) | import from the defining file | Biome `noReExportAll` + `noBarrelFile` |
| `eval`, `new Function`, `setTimeout("string")` | safe expression interpreter in `anim` | Biome `noGlobalEval` + security corpus |
| `innerHTML` / `dangerouslySetInnerHTML` without sanitizer | `sanitizeHtml()` / `sanitizeSvg()` from `format` | Biome + review |
| `console.*` in libraries | injected logger | Biome `noConsole` |
| Enums, namespaces, parameter properties | const objects, modules, explicit fields | TS `erasableSyntaxOnly` |
