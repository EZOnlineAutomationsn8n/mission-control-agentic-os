# Agent Task Distribution Ledger

Date activated: 2026-07-15
Status: CANONICAL_ACTIVE_REGISTER
Protocol: `docs/agentic-work-protocol/AGENTIC_WORK_PROTOCOL.md`

## Purpose

This ledger answers five questions without reopening old chats:

1. Which exact assignment exists?
2. Which orchestrator and worker own it?
3. On which host, workfloor, repository, branch, and workspace is it executed?
4. Where must the worker write its result and proof?
5. Who verifies and integrates the completed section?

This is an assignment and result register. It is not a replacement for project
state, source control, Shared Brain, audit evidence, or Paperclip task history.

## Routing order

| Layer | Primary | Fallback | Meaning |
| --- | --- | --- | --- |
| Orchestrator | Antigravity | Paperclip | Owns decomposition, dispatch, dependencies, and handoff |
| Tactical dispatcher | Codex | Explicit operator reassignment | Splits current work, checks results, integrates sections |
| Model | Assignment-specific | Recorded fallback chain | Thinking/execution model behind an agent |
| Provider | Assignment-specific | Recorded provider chain | Transport/provider for the selected model |

## Status vocabulary

`PROPOSED` → `ASSIGNED` → `RUNNING` → `OUTPUT_READY` → `VERIFYING` → `ACCEPTED` → `INTEGRATED` → `CLOSED`

Exception states:

- `WAITING_OPERATOR` — a decision or external action is required.
- `BLOCKED` — the worker cannot progress and supplied exact evidence.
- `EXHAUSTED_HANDOFF` — orchestrator/model/provider capacity ran out; the full assignment transfers unchanged.
- `REJECTED` — output failed acceptance and must not be integrated.

## Active assignments

| Assignment ID | Project | Objective | Orchestrator | Worker | Role | Execution host / workspace | Write target | Verifier | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | No active assignment recorded | — | — | — | — | — | — | — |

## Completed assignments

| Assignment ID | Project | Worker | Result | Output / evidence | Integrated by | Status |
| --- | --- | --- | --- | --- | --- | --- |
| MC-20260715-001 | Mission Control / Agentic OS | Codex | Functional isolated VPS cockpit staging | `docs/acceptance/STAGING_ACCEPTANCE_20260715.md` | Codex | CLOSED |
| MC-20260715-002 | Mission Control / Agentic OS | Codex | Codex VPS remote connection prepared | `docs/operations/CODEX_VPS_REMOTE_CONNECTION.md` | Codex | CLOSED |

## Assignment record template

Copy this complete block for every dispatched unit of work:

```yaml
assignment_id: PROJECT-YYYYMMDD-NNN
created_at_utc:
project:
parent_objective:
objective:
acceptance_result:
blueprint_work_package_id:
depends_on: []

orchestration:
  primary: Antigravity
  fallback: Paperclip
  current_owner:
  handoff_reason: null

worker:
  agent:
  role: builder | researcher | reviewer | verifier | integrator | background-worker
  runtime_mode: interactive | on-demand-cli | persistent-worker | scheduled-worker
  model_route: unknown-until-runtime-proof
  provider_route: unknown-until-runtime-proof

execution:
  machine: VPS | Windows | cloud
  workfloor:
  repository:
  branch:
  base_sha:
  workspace:
  sandbox_profile:

read_pack:
  common:
    - AGENTS.md
    - docs/looplines/MC_AGENTIC_OS_BUILD_BLUEPRINT.md
    - docs/acceptance/STAGING_ACCEPTANCE_20260715.md
  package_specific: []

authority:
  allowed:
  forbidden:
  requires_operator_approval:

delivery:
  write_target:
  allowed_write_paths: []
  evidence_target:
  required_tests:
  verifier:
  integrator:

capacity:
  priority: critical | high | normal | low
  context_budget: bounded | standard | extended
  stop_condition:
  fallback_trigger:

state:
  status: PROPOSED
  started_at_utc: null
  completed_at_utc: null
  blocker: null
  result_summary: null
  output_paths: []
  evidence_paths: []
  changed_files: []
  commit_sha: null
  unresolved_risks: []
  next_action: null
```

## Dispatch rules

1. One assignment owns one bounded result and one primary write target.
2. Two workers may not mutate the same files concurrently unless the assignment explicitly defines separate worktrees.
3. Research, implementation, review, and verification may be parallel only when their write surfaces do not overlap.
4. The worker must write the result to the declared target; chat output alone is not delivery.
5. Runtime identity, model, provider, host, workspace, branch, and SHA are evidence fields, not assumptions.
6. An orchestrator fallback receives the existing assignment record; it must not silently create a differently named duplicate task.
7. Every accepted output gets an integration owner. Unintegrated output is not finished project work.
8. Every closed assignment records proof, remaining risks, and the next controlled action.
9. Production deploy, secrets, external publishing, destructive cleanup, and canonical Shared Brain promotion remain operator gates.

## Capacity-routing principle

Use scarce high-capability context for architecture, ambiguity, integration,
hard debugging, and final review. Delegate bounded repository mapping, focused
implementation, test execution, source classification, and repetitive evidence
collection to suitable workers. Capacity exhaustion triggers a recorded
handoff—not loss of continuity and not a fresh task with a new truth.
