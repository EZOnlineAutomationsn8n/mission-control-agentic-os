# Assignment MC-SRC-003 — Active Source Consumer Trace

Assigned agent: Claude Code  
Blueprint object: `MC_SRC.P1`, `MC_SRC.P3`, and `MC_AGT.P1`  
Mode: read-only code tracing; one report write allowed  
Workspace: `/workspace/projects/mission-control`

## Why

Files are not authoritative merely because they exist. We need to know what the
application, agent runners, scripts, and operator workflow actually read.

## Required work

1. Trace all code and scripts that load instructions, agent profiles, workspace context, Shared Brain sources, runtime configuration, model routes, or assignments.
2. Trace the common agent session start path from UI/API to runner invocation.
3. Record the exact files, environment variables, database tables, and fallback behavior consumed at runtime.
4. Identify mock/legacy paths still reachable and unreferenced documents that look active by name only.
5. Identify the minimum enforceable agent read-pack and the best preflight insertion point.
6. Do not implement the preflight or change any source.

## Forbidden

- Do not edit code, configuration, documentation, dependencies, or database state.
- Do not start external agents or consume provider/model capacity.
- Do not commit, push, restart, deploy, delete, move, or clean.

## Delivery

Write exactly one report:

`/workspace/projects/mission-control/reports/looplines/MC_SRC/MC-SRC-003_CLAUDE_SOURCE_CONSUMER_TRACE.md`

Required report structure:

```text
# MC-SRC-003 Active Source Consumer Trace
## Execution identity
## UI-to-runner session path
## Instruction and context consumers
## Assignment and workspace consumers
## Runtime configuration and environment consumers
## Database-backed sources
## Reachable mocks or legacy paths
## Unreferenced active-looking files
## Minimum read-pack recommendation
## Preflight insertion point
## Missing evidence and risks
## Commands executed
```

Every trace must use exact file paths and symbols or line references. Finish your
terminal reply with exactly:

`MC_SRC_003_OUTPUT_READY`
