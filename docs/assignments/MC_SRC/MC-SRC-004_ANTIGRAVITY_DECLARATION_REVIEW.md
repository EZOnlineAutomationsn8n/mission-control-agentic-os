# Assignment MC-SRC-004 — MC_SRC Declaration Dependency Review

Assigned agent: Antigravity  
Blueprint object: complete `MC_SRC` loopline  
Mode: architecture review; one report write allowed  
Workspace: `/workspace/projects/mission-control`

## Why

Before the definitive MC_SRC declaration is written, an independent architect
must test whether the working blueprint covers source authority, provenance,
reproducibility, agent intake, integration, and cross-loopline dependencies.

## Required work

1. Read sections 1–7, 15–17, and 19 of `docs/looplines/MC_AGENTIC_OS_BUILD_BLUEPRINT.md`.
2. Review every `MC_SRC` parent loop and work package for completeness, overlap, ambiguity, and unverifiable closure criteria.
3. Map upstream/downstream dependencies between MC_SRC and MC_OPS, MC_STATE, MC_UI, MC_AGT, MC_CTRL, MC_CON, and MC_ORCH.
4. Propose required subloops beneath each MC_SRC parent loop.
5. Identify where one work package is too large, too vague, incorrectly ordered, or missing an operator gate.
6. Do not rewrite the blueprint or declaration.

## Forbidden

- Do not edit existing files except the declared report.
- Do not invent current-state facts or percentages.
- Do not import ViREON loopline content into Mission Control.
- Do not commit, push, restart, deploy, delete, move, or clean.

## Delivery

Write exactly one report:

`/workspace/projects/mission-control/reports/looplines/MC_SRC/MC-SRC-004_ANTIGRAVITY_DECLARATION_REVIEW.md`

Required report structure:

```text
# MC-SRC-004 Declaration Dependency Review
## Execution identity
## Coverage assessment
## Parent-loop findings
## Proposed subloops
## Cross-loopline dependency matrix
## Oversized or ambiguous work packages
## Missing work packages
## Missing operator gates
## Recommended declaration order
## Assumptions and unknowns
## Commands executed
```

Finish your terminal reply with exactly:

`MC_SRC_004_OUTPUT_READY`
