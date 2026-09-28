# @fluxion/core

Document store (records + signals), transactions, commands, undo/redo, queries, registries.

| Layer | Pure | Status |
|---|---|---|
| L1 | yes | M3: store, transactions, hooks, commands, history, forks, registries |

```ts
import { createCore } from '@fluxion/core';

// the store with the built-in hooks, and the registries with the built-in commands
const { store, registries, execute } = createCore(file);
const r = execute('element.update', { id, fields: { name: 'Box' } });
if (!r.ok) console.log(r.error.diagnostics);
store.history.undo();
```

- Every write is a transaction that returns a `Result` and leaves the store unchanged on failure;
  commands are the way in (ADR-0014).
- `store.fork()` gives an O(1) copy-on-write preview; `applyFork(store, fork)` writes it back as
  one undo step.
- Benchmarks: `pnpm bench` (NFR-PERF-006, 5 000 records).

Design: [docs/architecture/03-core-engine.md](../../docs/architecture/03-core-engine.md) ·
[ADR-0014](../../docs/architecture/decisions/ADR-0014-command-and-transaction-semantics.md) ·
API: [api/core.api.md](api/core.api.md).
