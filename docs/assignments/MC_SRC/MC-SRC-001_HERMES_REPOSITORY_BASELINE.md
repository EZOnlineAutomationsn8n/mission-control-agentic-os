# Assignment MC-SRC-001 — Repository Baseline Evidence

Assigned agent: Hermes  
Blueprint object: `MC_SRC.P2` and `MC_SRC.P4`  
Mode: read-only investigation; one report write allowed  
Workspace: `/workspace/projects/mission-control`

## Why

The new MC_SRC declaration needs a factual baseline of the engineering repository.
Do not infer authority from filenames, old locks, or modification dates.

## Required work

1. Confirm workspace, Git branch, HEAD, remotes, status, upstream state, and recent relevant commits.
2. Inventory instruction, architecture, state, plan, acceptance, operation, loopline, and Shared Brain documents inside this repository.
3. Identify which documents are referenced by code, scripts, package commands, AGENTS files, or other active documents.
4. Map package scripts, migrations, tests, runtime/config files, and build entrypoints that define the reproducible baseline.
5. Separate proven facts, reasonable inference, missing evidence, and conflicts.
6. Do not classify anything as canonical, obsolete, or safe to delete without direct evidence.

## Forbidden

- Do not edit source code or existing documentation.
- Do not commit, push, install, restart, deploy, delete, move, or clean.
- Do not inspect or mix PortMontage or ViREON content beyond identifying a scope boundary.

## Delivery

Write exactly one report:

`/workspace/projects/mission-control/reports/looplines/MC_SRC/MC-SRC-001_HERMES_REPOSITORY_BASELINE.md`

Required report structure:

```text
# MC-SRC-001 Repository Baseline Evidence
## Execution identity
## Git facts
## Active instruction and documentation routes
## Build, migration, and test baseline
## Referenced versus unreferenced sources
## Proven facts
## Inferences
## Missing evidence
## Conflicts and risks
## Recommended MC_SRC declaration inputs
## Commands executed
```

Every material claim must include a repository path, command result, commit, or
line reference. Finish your terminal reply with exactly:

`MC_SRC_001_OUTPUT_READY`
