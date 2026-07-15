# Shared Brain Canonical Contract

Mission Control uses two separate persistence concepts:

1. The source register records where continuity artifacts exist and what evidence supports their classification.
2. The append-only event ledger records actual state changes with an actor, scope, timestamp, summary, and evidence references.

One artifact may be canonical only for one explicit scope and artifact kind. A ViREON LifeFeed cannot become the Mission Control LifeFeed by path proximity or naming similarity. Handover, current state, and LifeFeed are related but not interchangeable:

- `CURRENT_STATE` describes the latest verified operational state.
- `LifeFeed` is an append-only event stream.
- `handover` transfers enough bounded context to resume one task or phase.
- evidence proves a claim but does not itself become current state.

Promotion to `canonical` requires an explicit operator decision. Duplicate detection may be automated from SHA-256, but deletion remains a separate operator-controlled action.
