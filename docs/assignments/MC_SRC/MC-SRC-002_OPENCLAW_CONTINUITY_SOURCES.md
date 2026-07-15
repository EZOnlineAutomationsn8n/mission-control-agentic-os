# Assignment MC-SRC-002 — Continuity Source Classification Evidence

Assigned agent: OpenClaw  
Blueprint object: `MC_SRC.P1` and `MC_STATE.P5`  
Mode: read-only classification; one report write allowed  
Workspace: `/workspace/projects/mission-control`

## Why

Mission Control has multiple plans, handovers, LifeFeed/current-state candidates,
locks, reports, archives, and duplicate names. The declaration needs evidence,
not another competing source of truth.

## Required work

1. Read `docs/shared-brain/CANONICAL_CONTRACT.md` and `docs/shared-brain/SOURCE_CONSOLIDATION_REPORT.md`.
2. Inspect `reports/shared-brain-source-inventory.json` if present.
3. Inventory Mission Control continuity-related sources accessible from the sandbox.
4. Classify each only as `candidate`, `evidence`, `plan`, `handover`, `decision_or_lock`, `legacy`, `archive`, `duplicate`, or `unknown`.
5. Record exact scope: Mission Control, ViREON, PortMontage, or unknown.
6. Identify duplicate intent, conflicting claims, missing consumers, and missing canonical decisions.
7. Do not promote or rewrite any source.

## Forbidden

- Do not edit vault notes, LifeFeed, current state, source registers, or existing docs.
- Do not declare a canonical source.
- Do not delete, move, rename, merge, commit, push, restart, or deploy.
- Do not treat a handover as system truth or a plan as executed state.

## Delivery

Write exactly one report:

`/workspace/projects/mission-control/reports/looplines/MC_SRC/MC-SRC-002_OPENCLAW_CONTINUITY_SOURCES.md`

Required report structure:

```text
# MC-SRC-002 Continuity Source Classification Evidence
## Execution identity
## Sources inspected
## Classification table
## Exact duplicates
## Same-purpose non-identical sources
## Conflicting claims
## Scope-boundary findings
## Missing evidence and consumers
## Operator decisions still required
## Recommended MC_SRC declaration inputs
## Commands executed
```

Use absolute source paths and hashes when available. Finish your terminal reply
with exactly:

`MC_SRC_002_OUTPUT_READY`
