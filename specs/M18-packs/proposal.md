# M18 — Portable shape packs

Implement FR-LIB-003–009/011, FR-CON-010, FR-AST-003 and NFR-LIC-003 from the
existing M18 scope, plus the explicit M15/M17 handoffs. This is a fresh reconstruction;
prior interrupted-session tests are not evidence for this checkout.

Deliver twelve licensed declarative packs, safe import, lazy loading, used-definition
persistence, reusable custom shapes, replacement, connector types and optional font
subsets. Remote registries, executable pack plugins and document import remain outside M18.
The circular-only timing exception is already authorized; its requirement/ADR change is
M18.6, not a general relaxation of performance or correctness.
