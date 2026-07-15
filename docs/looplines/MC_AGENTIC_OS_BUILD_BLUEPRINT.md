# Mission Control / Agentic OS Build Blueprint

Status: `WORKING_BLUEPRINT_AWAITING_OPERATOR_ACCEPTANCE`  
Project: Mission Control / Agentic OS  
Execution source: `sandbox/functional-agentic-os`  
Runtime target: isolated VPS staging first; live only after explicit operator approval  
Last evidence baseline: `docs/acceptance/STAGING_ACCEPTANCE_20260715.md`

## 1. Purpose and authority

This document is the complete project build map. It defines what must be built,
in which dependency order, how work is divided, and what evidence closes each
part. It does not replace current state, task assignment, audit evidence, or Git.

The operator owns intent, priority, scope, and promotion authority. An agent may
execute only a bounded work package assigned through
`docs/operations/AGENT_TASK_DISTRIBUTION_LEDGER.md`.

This blueprint becomes canonical only after explicit operator acceptance. Until
then it is the single working proposal and must not be copied into competing
declarations.

### 1.1 Read without scrolling through the complete blueprint

- Operator overview: sections 2, 5, 6, 18, and 19.
- Assigned worker: sections 1–4, its assigned parent loop, sections 15–17, and
  the exact ledger record.
- Verifier: assigned parent loop, its acceptance evidence, and the closeout.
- Nobody needs to paste this complete file into chat. Agents read it from the
  repository and write results to the declared delivery path.

## 2. Product outcome

Mission Control is an operator cockpit from which Dennis can:

1. start, stop, select, and converse with real agents;
2. attach files and images to real agent sessions;
3. create, assign, approve, monitor, and close real work;
4. use Antigravity or Paperclip for orchestration without losing assignments
   when an orchestrator, model, or provider becomes unavailable;
5. inspect persistent conversations, project state, evidence, and audit history;
6. connect approved external services without presenting mocks as operational;
7. recover after refresh, process restart, release rollback, or agent handoff;
8. operate staging safely and promote to live only through an operator gate.

The product is not complete when cards render or health endpoints return 200.
Closure requires the complete visible operator workflow to execute and persist.

## 3. Scope boundaries

- Mission Control is the cockpit and operational workspace.
- ViREON is a separate governance core; it is not Mission Control and is not an
  executing orchestrator.
- Paperclip is a separate control plane that may be integrated or surfaced.
- Antigravity is an agentic coding assistant and intended orchestration option.
- FCC is a model gateway used by Claude Code; FCC is not the Claude Code agent.
- Agent identity, model route, provider route, session, workspace, branch, and
  runtime must be recorded separately.
- PortMontage, PIP, ViREON, and other projects remain separate project scopes.
- No fake commands, seeded success, fabricated agent identity, or cosmetic
  connected state may close a work package.

## 4. Control model

### 4.1 Object hierarchy

```text
PROJECT
└── LOOPLINE                         stable responsibility domain
    └── PARENT LOOP                  coherent capability
        └── CONTROLLED WORK PACKAGE  delegatable result
            ├── input and authority
            ├── bounded write surface
            ├── verification
            └── acceptance evidence
```

### 4.2 Status vocabulary

| Status | Meaning |
| --- | --- |
| `PROVEN_BASELINE` | Visible end-to-end behavior is evidenced on isolated staging. |
| `PARTIAL` | A real part works, but the parent-loop acceptance gate is not closed. |
| `OPEN` | Required work has not yet been proven. |
| `BLOCKED_EXTERNAL` | Work needs an external credential, provider, device login, or approved contract. |
| `OPERATOR_GATE` | Implementation may be ready, but Dennis must decide or approve. |
| `CLOSED` | All defined proof for the work package is accepted and recorded. |

No percentage is inferred from these statuses.

### 4.3 Evidence rule

Every work package closes with all applicable evidence:

- changed files and commit SHA;
- automated tests, type check, lint, and production build;
- runtime identity, host, workspace, branch, and release;
- visible browser workflow with real success or honest real failure;
- persisted state read back after refresh or restart;
- audit/evidence entry;
- regression check for affected closed capabilities;
- unresolved risks and next dependency.

### 4.4 Source conflict resolution

Names such as `LOCK`, `CURRENT_STATE`, `LifeFeed`, `handover`, or `canonical` do
not establish authority by themselves. Modification time alone is also not proof
of current use. Conflicts are resolved by claim type and current evidence:

1. explicit operator intent, scope, approval, or accepted decision;
2. direct current runtime evidence for operational behavior;
3. Git-traceable source, tests, migrations, and release provenance;
4. an operator-accepted declaration or current-state artifact for its exact scope;
5. accepted architecture decisions and locks for the boundary they govern;
6. plans and working blueprints, which describe intended work;
7. task handovers and reports, which transfer bounded context;
8. historical logs and archives.

A lower source may add evidence but cannot silently override a higher source. A
handover never becomes system truth by repetition, and a plan claim never becomes
current state without execution evidence.

## 5. Project phase map

Phases are dependency gates, not progress percentages. Work in a later phase may
already have a proven baseline, but that does not silently close earlier gates.

```text
PHASE 0  SOURCE AUTHORITY
   MC_SRC
      │
      ▼
PHASE 1  SAFE ENGINEERING SUBSTRATE
   MC_OPS + MC_STATE foundation
      │
      ▼
PHASE 2  OPERATOR COCKPIT
   MC_UI
      │
      ▼
PHASE 3  REAL AGENT EXECUTION
   MC_AGT + FCC portion of MC_CON
      │
      ▼
PHASE 4  CONTROL AND DURABILITY
   MC_CTRL + MC_STATE
      │
      ▼
PHASE 5  ORCHESTRATION AND SERVICE BRIDGES
   MC_ORCH + remaining MC_CON
      │
      ▼
PHASE 6  SHARED BRAIN AND CONTINUITY
   MC_STATE + MC_ORCH + MC_SRC
      │
      ▼
PHASE 7  SYSTEM ACCEPTANCE AND PROMOTION
   all looplines converge in MC_OPS
```

### Phase gates

| Phase | Gate required before controlled advance |
| --- | --- |
| 0 | One source register, one accepted blueprint, protected sources classified, exact repo/branch/SHA known. |
| 1 | Reproducible isolated staging, durable database, migrations, backup/restore proof, live untouched. |
| 2 | Responsive cockpit with 2x2 interchangeable terminals and honest empty/error/loading states. |
| 3 | Each enabled agent has real start/send/output/stop/persist evidence and exact identity boundaries. |
| 4 | Work, approvals, audit, evidence, attachments, and conversations survive refresh/restart and reject invalid transitions. |
| 5 | Orchestration handoff and each external write bridge use a scoped contract and show real receipts. |
| 6 | Canonical sources are operator-selected; closeouts update current state and append LifeFeed once without scope mixing. |
| 7 | Full regression, security/recovery tests, clean release provenance, rollback, reboot survival, and operator GO. |

## 6. Loopline index

| Loopline | Responsibility | Primary phase span |
| --- | --- | --- |
| `MC_SRC` | Source, repositories, baseline, and agent read-pack | 0–7 |
| `MC_UI` | Cockpit shell and operator interface | 2–7 |
| `MC_CTRL` | Approvals and operator control | 4–7 |
| `MC_AGT` | Agent rooms and real sessions | 3–7 |
| `MC_CON` | Connectors to real services | 3–7 |
| `MC_STATE` | Persistence, audit, evidence, and continuity state | 1–7 |
| `MC_ORCH` | Antigravity, Paperclip, Mastermind, and work dispatch | 5–7 |
| `MC_OPS` | VPS staging, release, deployment, recovery, and runtime operations | 1–7 |

## 7. MC_SRC — Source, repositories, and baseline

### MC_SRC.P1 — Source authority and project routing (`PARTIAL`)

Purpose: make one explicit source chain authoritative without deleting evidence.

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_SRC.P1.W1` | Classify every Mission Control instruction, plan, state, handover, lock, and archive as current, evidence, legacy, duplicate, or rejected. | Fingerprinted register with scope and classification. |
| `MC_SRC.P1.W2` | Operator accepts this blueprint or returns bounded corrections. | Decision record referencing this exact file hash. |
| `MC_SRC.P1.W3` | Publish one routing index explaining which artifact answers plan, current state, assignments, evidence, and history. | A new agent retrieves each answer without opening old chats. |
| `MC_SRC.P1.W4` | Preserve ViREON, PortMontage, Mission Control, and archive scope separation. | Automated or reviewed cross-scope conflict report. |

Gate: no competing declaration can silently override the accepted blueprint.

### MC_SRC.P2 — Repository and branch provenance (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_SRC.P2.W1` | Register protected Windows sources, engineering sandbox, GitHub refs, VPS staging source, and live release. | Path, remote, branch, HEAD, dirty state, owner, and protection per source. |
| `MC_SRC.P2.W2` | Classify all historical Mission Control worktrees and unique unintegrated changes. | Diff-based classification; no assumption from folder name. |
| `MC_SRC.P2.W3` | Define the clean integration branch and provenance chain for accepted work. | Reproducible ancestry and clean diff proof. |
| `MC_SRC.P2.W4` | Detect source drift between Windows, GitHub, staging, and live. | Machine-readable comparison and human-readable exception list. |

Gate: every release artifact traces to one reviewed commit and every protected
dirty source remains recoverable.

### MC_SRC.P3 — Agent read-pack and assignment entry (`OPEN`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_SRC.P3.W1` | Define the minimum common read-pack in section 16. | Two different agents restate the same scope and constraints. |
| `MC_SRC.P3.W2` | Add `blueprint_work_package_id` and exact read/write targets to every live assignment. | Ledger validation finds no unbounded assignment. |
| `MC_SRC.P3.W3` | Add a preflight that refuses execution on wrong repo, branch, workspace, or scope. | Deliberately wrong assignment fails before mutation. |
| `MC_SRC.P3.W4` | Add a closeout template that records proof and updates the ledger. | Completed package is discoverable without chat history. |

Gate: an agent can resume one package after handoff without scanning the entire
vault and without inventing a new objective.

### MC_SRC.P4 — Reproducible development baseline (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_SRC.P4.W1` | Pin runtime, package manager, dependencies, environment contract, and migrations. | Clean checkout builds and migrates in sandbox. |
| `MC_SRC.P4.W2` | Document sanitized fixtures and allowed read-only snapshots. | No production secret/data copied into writable fixtures. |
| `MC_SRC.P4.W3` | Create one verification command covering unit, integration, type, lint, and build gates. | Single command produces a structured receipt. |

Gate: a fresh worker can reproduce the accepted baseline without hidden manual
steps.

## 8. MC_UI — Cockpit shell and operator interface

### MC_UI.P1 — Shell, navigation, and responsive layout (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_UI.P1.W1` | Maintain one shell with workspace, agents, work, system, and evidence navigation. | Browser route traversal with no dead or fake page. |
| `MC_UI.P1.W2` | Keep the four main terminals in a tall 2x2 desktop grid with useful scroll and input space. | Desktop screenshot plus interaction at target resolution. |
| `MC_UI.P1.W3` | Add deliberate tablet/mobile behavior without collapsing operator controls. | Responsive acceptance on agreed viewports. |
| `MC_UI.P1.W4` | Make focused room selection and sidebar assignment consistent. | Selected agent opens in the chosen terminal and survives refresh. |

### MC_UI.P2 — Interchangeable operator terminals (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_UI.P2.W1` | Preserve agent selector, exact session ID, start/stop, prompt/send, output, and clear confirmation per terminal. | Browser proof for every control. |
| `MC_UI.P2.W2` | Ensure terminal slots are interchangeable rather than permanently agent-bound. | Swap agents between slots without state leakage. |
| `MC_UI.P2.W3` | Display agent, runtime, model, provider, attempts, duration, workspace, and failure provenance when actually known. | Values match server receipt; unknown is shown as unknown. |
| `MC_UI.P2.W4` | Separate session stopped, idle, running, failed, blocked, and unavailable states. | Controlled state-transition test. |

### MC_UI.P3 — Operator input and artifacts (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_UI.P3.W1` | Support file/image attachment with validation and persistent metadata. | Attach, send, refresh, retrieve proof. |
| `MC_UI.P3.W2` | Support camera capture through the operator browser where available. | Real capture is delivered to the selected session. |
| `MC_UI.P3.W3` | Reject executable, oversized, unsupported, and cross-session attachment access. | Negative security tests and audit entries. |
| `MC_UI.P3.W4` | Add explicit artifact preview/removal before send. | Operator can inspect and remove the right artifact. |

### MC_UI.P4 — Work and system surfaces (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_UI.P4.W1` | Projects, Pipeline, Queue, Mastermind, Brain, Approvals, Evidence, and Registry render real persisted data. | Fresh API/database comparison for every page. |
| `MC_UI.P4.W2` | Remove or hide every command surface without a real backend route. | Registry-to-UI route audit has no false action. |
| `MC_UI.P4.W3` | Add useful empty/loading/error/retry states to all operator pages. | Fault-injection browser acceptance. |
| `MC_UI.P4.W4` | Surface external Paperclip as a separate cockpit/integration, not a mislabeled Mission Control page. | Operator can see ownership and runtime boundary. |

Gate for MC_UI: Dennis can operate all enabled functions without terminals or
developer tools, and every unavailable function states the exact missing bridge.

## 9. MC_CTRL — Approvals and operator control

### MC_CTRL.P1 — Approval lifecycle (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CTRL.P1.W1` | Preserve pending, approve, reject-with-reason, history, idempotency, and refresh persistence. | Focused tests plus visible rejection and audit proof. |
| `MC_CTRL.P1.W2` | Define approval types and required context for deploy, secrets, destructive actions, publishing, and canonical promotion. | Schema validation rejects incomplete requests. |
| `MC_CTRL.P1.W3` | Bind approvals to exact actor, scope, action hash, expiry, and execution receipt. | Changed request cannot reuse old approval. |

### MC_CTRL.P2 — Authority and execution gates (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CTRL.P2.W1` | Centralize capability policy for sandbox mutation, external writes, production, secrets, and deletion. | Route-level policy coverage report. |
| `MC_CTRL.P2.W2` | Enforce operator gates server-side, not only by disabled UI controls. | Direct API bypass attempt is rejected and audited. |
| `MC_CTRL.P2.W3` | Keep reversible sandbox work autonomous while live promotion remains operator-controlled. | Allowed/denied matrix exercised end-to-end. |

### MC_CTRL.P3 — Recovery and operator intervention (`OPEN`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CTRL.P3.W1` | Add cancel, retry, reassign, and resume controls for work and agent runs. | Interrupted run resumes or closes without duplicate execution. |
| `MC_CTRL.P3.W2` | Add safe rollback request and receipt display. | Staging release rollback restores prior verified SHA/state. |
| `MC_CTRL.P3.W3` | Add explicit emergency stop boundaries without stopping unrelated services. | Scoped stop test and recovery proof. |

Gate for MC_CTRL: no gated action can execute without matching authority, and
every accepted or rejected decision is durable, visible, and replay-safe.

## 10. MC_AGT — Agent rooms and real sessions

### MC_AGT.P1 — Common session contract (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_AGT.P1.W1` | Maintain one session API for start, prompt, stream/result, stop, history, and clear. | Contract tests across every enabled adapter. |
| `MC_AGT.P1.W2` | Store exact agent identity separately from backing model/provider. | Self-report is labeled separately from machine evidence. |
| `MC_AGT.P1.W3` | Bind session to project, workspace, assignment, actor, and terminal slot. | Cross-project/session isolation tests. |
| `MC_AGT.P1.W4` | Define interactive, on-demand CLI, persistent worker, and scheduled worker modes. | UI and registry expose the correct mode and controls. |

### MC_AGT.P2 — Claude Code through FCC (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_AGT.P2.W1` | Preserve real Claude Code CLI execution through the FCC gateway. | Claude Code identity plus CLI/runtime receipt. |
| `MC_AGT.P2.W2` | Keep the nine-route FREE-only coding-first fallback and fail safely after exhaustion. | Attempt list, chosen route, and no paid fallback proof. |
| `MC_AGT.P2.W3` | Remove obsolete OwlAlpha labels from active behavior while preserving historical evidence. | Runtime config and UI registry agree. |

### MC_AGT.P3 — Hermes (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_AGT.P3.W1` | Preserve on-demand Hermes start/send/output/stop. | Browser pass with exact session number. |
| `MC_AGT.P3.W2` | Report on-demand CLI readiness separately from permanent service health. | No false degraded state when no daemon is expected. |

### MC_AGT.P4 — Antigravity (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_AGT.P4.W1` | Preserve real Antigravity session behavior and use one name: Antigravity. | UI, registry, adapter, and receipts use one identity. |
| `MC_AGT.P4.W2` | Prove sandbox/project binding and bounded write access. | Agent writes only to assigned target and reports workspace. |
| `MC_AGT.P4.W3` | Add capacity/exhaustion signal suitable for orchestrator handoff. | Controlled exhaustion creates one unchanged fallback assignment. |

### MC_AGT.P5 — OpenClaw (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_AGT.P5.W1` | Preserve real OpenClaw start/send/output/stop. | Browser pass and persistent session receipt. |
| `MC_AGT.P5.W2` | Separate OpenClaw runtime identity from a loaded persona such as MarketScout. | UI reports agent, persona, model, and project independently. |

### MC_AGT.P6 — Codex (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_AGT.P6.W1` | Preserve ChatGPT-account authenticated Codex CLI without adding an OpenAI API key. | VPS CLI and browser session proof. |
| `MC_AGT.P6.W2` | Document subscription-limit failure and re-auth behavior honestly. | Controlled unavailable state gives exact operator action. |

### MC_AGT.P7 — Gemini (`BLOCKED_EXTERNAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_AGT.P7.W1` | Complete Google device authorization in the correct active VPS session. | Credential stored by Gemini CLI; no code pasted as shell command. |
| `MC_AGT.P7.W2` | Prove start/send/output/stop and session persistence. | Browser pass equivalent to other real agents. |
| `MC_AGT.P7.W3` | Prove expired/revoked-auth behavior. | Honest blocker and re-auth path. |

Gate for MC_AGT: every enabled room represents a real controllable agent. Any
unavailable agent shows the exact blocker and offers no fake Send action.

## 11. MC_CON — Connectors to real services

### MC_CON.P1 — Connector contract and registry (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CON.P1.W1` | Standardize identity, health, capabilities, read/write authority, actions, evidence, and failure classes. | All registered adapters pass contract validation. |
| `MC_CON.P1.W2` | Distinguish installed, reachable, authenticated, readable, writable, and commandable. | Registry cannot collapse these into one connected flag. |
| `MC_CON.P1.W3` | Discover adapters from reviewed registration, not UI placeholders. | Registry count matches executable server routes. |

### MC_CON.P2 — FCC and model routing (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CON.P2.W1` | Preserve free-only fallback configuration and attempt receipts. | Model registry, adapter, and runtime agree. |
| `MC_CON.P2.W2` | Add route availability sampling without consuming paid routes. | Status differentiates unavailable, rate-limited, timeout, and exhausted. |

### MC_CON.P3 — Paperclip (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CON.P3.W1` | Keep Paperclip external cockpit address and health/read boundary visible. | Real external runtime opens and status matches. |
| `MC_CON.P3.W2` | Define a scoped project/task/run/approval API contract. | Reviewed allowlist and least-privilege credential plan. |
| `MC_CON.P3.W3` | Create, update, and read back one sandbox task with correlation ID. | Paperclip object, Mission Control ledger, and audit receipt match. |
| `MC_CON.P3.W4` | Reconcile Paperclip retry/handoff without duplicate tasks. | Idempotency test. |

### MC_CON.P4 — n8n (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CON.P4.W1` | Preserve real health discovery without changing workflows. | Version/runtime/status receipt. |
| `MC_CON.P4.W2` | Define an allowlisted webhook or scoped API credential contract. | Operator-approved action schema and secret boundary. |
| `MC_CON.P4.W3` | Trigger one sandbox workflow and persist its execution receipt. | Input, execution ID, output/failure, and audit correlation. |
| `MC_CON.P4.W4` | Add timeout, retry, cancellation, and duplicate suppression. | Fault-injection tests. |

### MC_CON.P5 — Obsidian, OMI, and Shared Brain bridge (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CON.P5.W1` | Register exact vault roots, scopes, sync method, and read/write boundary. | Path and synchronization proof from both VPS and operator view. |
| `MC_CON.P5.W2` | Keep OMI pre-processing as an input stage, not an authority source. | Produced artifact retains origin and awaits classification. |
| `MC_CON.P5.W3` | Write one sandbox Brain event through the approved bridge and read it back. | File/database/event correlation without scope mixing. |

### MC_CON.P6 — Browser Agents (`BLOCKED_EXTERNAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_CON.P6.W1` | Define approved browser, profile, CDP endpoint, and credential boundary. | Security review and operator decision. |
| `MC_CON.P6.W2` | Connect one sandbox browser agent and execute a harmless visible action. | Screen evidence, CDP receipt, and audit event. |
| `MC_CON.P6.W3` | Prove disconnect/reconnect and stale-tab handling. | Recovery test. |

Gate for MC_CON: each connector advertises only proven capabilities; every write
action is scoped, correlated, persisted, and recoverable.

## 12. MC_STATE — Persistence, audit, evidence, and continuity

### MC_STATE.P1 — Database foundation (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_STATE.P1.W1` | Maintain versioned PostgreSQL migrations for all durable domains. | Empty database migrates to current schema. |
| `MC_STATE.P1.W2` | Add constraints, transaction boundaries, and idempotency keys. | Concurrency and duplicate-request tests. |
| `MC_STATE.P1.W3` | Define retention and deletion policy separately from archive preservation. | Operator-approved policy; no automatic destructive cleanup. |

### MC_STATE.P2 — Sessions, conversations, and attachments (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_STATE.P2.W1` | Preserve sessions and conversation entries after refresh/recreate. | Browser and database readback. |
| `MC_STATE.P2.W2` | Bind attachments to actor, project, session, hash, storage path, and lifecycle. | Isolation and integrity tests. |
| `MC_STATE.P2.W3` | Add export and bounded recovery for one session. | Restored session matches hashes and ordering. |

### MC_STATE.P3 — Projects, work, and approvals (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_STATE.P3.W1` | Preserve project/work lifecycle and reject invalid transitions. | Integration tests and visible Pipeline/Queue state. |
| `MC_STATE.P3.W2` | Link work item, blueprint package, assignment, approval, agent session, and result. | One end-to-end correlated work chain. |

### MC_STATE.P4 — Audit and evidence (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_STATE.P4.W1` | Maintain append-only audit events with actor, action, target, result, and correlation. | Tamper/duplicate/order tests. |
| `MC_STATE.P4.W2` | Store evidence references and hashes without treating evidence as current state. | Evidence page resolves the exact source and claim. |
| `MC_STATE.P4.W3` | Produce a closure receipt for every closed work package. | Ledger, database, Git, runtime, and evidence reconcile. |

### MC_STATE.P5 — Shared Brain state model (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_STATE.P5.W1` | Preserve the source register and append-only event ledger as separate concepts. | Schema and UI enforce the distinction. |
| `MC_STATE.P5.W2` | Operator selects canonical Mission Control project, current state, active work, LifeFeed, decision, evidence, incident, and register locations. | Explicit decision record per scope/artifact kind. |
| `MC_STATE.P5.W3` | Update current state and append one LifeFeed event from an accepted closeout. | Idempotent replay produces no duplicate event. |
| `MC_STATE.P5.W4` | Generate handover as a bounded derivative, never as a competing truth source. | Handover regenerates from canonical sources and assignment. |

### MC_STATE.P6 — Backup, restore, and continuity (`OPEN`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_STATE.P6.W1` | Back up database, attachment store, configuration, and accepted source indexes. | Encrypted/sanitized backup receipt. |
| `MC_STATE.P6.W2` | Restore into a clean isolated runtime. | Full operator workflow reads restored state. |
| `MC_STATE.P6.W3` | Prove restart/reboot survival and document recovery time/objective. | Controlled reboot/recreate acceptance. |

Gate for MC_STATE: all operator-critical state is durable, correlated, scoped,
backed up, restorable, and never dependent on chat memory alone.

## 13. MC_ORCH — Orchestration and work distribution

### MC_ORCH.P1 — Assignment contract and ledger (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_ORCH.P1.W1` | Add blueprint package ID, dependencies, read-pack, write surface, authority, capacity, verifier, and integrator to assignments. | Ledger schema validation. |
| `MC_ORCH.P1.W2` | Ensure one bounded result and primary write target per assignment. | Concurrent-conflict preflight. |
| `MC_ORCH.P1.W3` | Record results in files/evidence, not only chat. | New session retrieves output from declared target. |

### MC_ORCH.P2 — Mastermind dispatch (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_ORCH.P2.W1` | Preserve persisted project/work dispatch and visible queue state. | Real work item from creation through shipped. |
| `MC_ORCH.P2.W2` | Bind dispatch to selected blueprint package and dependencies. | Dispatch rejects missing/unclosed prerequisite. |
| `MC_ORCH.P2.W3` | Add worker capability matching without silently changing objective. | Selection rationale and operator-visible route. |

### MC_ORCH.P3 — Antigravity primary orchestration (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_ORCH.P3.W1` | Give Antigravity a bounded orchestration assignment from the common ledger. | Decomposition retains original object and constraints. |
| `MC_ORCH.P3.W2` | Dispatch non-overlapping worker packages and collect results at declared targets. | At least two sections reconcile without write conflict. |
| `MC_ORCH.P3.W3` | Emit capacity/exhaustion and handoff state before context is lost. | Full unchanged assignment transfers with evidence. |

### MC_ORCH.P4 — Paperclip durable fallback (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_ORCH.P4.W1` | Mirror accepted assignment identity/state into Paperclip through scoped integration. | IDs and state reconcile bidirectionally. |
| `MC_ORCH.P4.W2` | Resume an `EXHAUSTED_HANDOFF` without creating a renamed duplicate objective. | Controlled fallback demonstration. |
| `MC_ORCH.P4.W3` | Preserve operator approvals and dependencies across handoff. | Pending gate remains pending and cannot be bypassed. |

### MC_ORCH.P5 — Verification and integration (`OPEN`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_ORCH.P5.W1` | Separate builder, reviewer, verifier, and integrator roles for risky packages. | Independent review record. |
| `MC_ORCH.P5.W2` | Reconcile multiple accepted sections on a clean integration branch. | Combined regression suite and conflict report. |
| `MC_ORCH.P5.W3` | Reject incomplete output back to the same assignment rather than creating new truth. | Rework history remains one lineage. |

### MC_ORCH.P6 — Pulse, heartbeat, and scheduled workers (`OPEN`)

Purpose: use a pulse as a lightweight wake-up signal, never as a repeated full
conversation or endlessly reissued assignment.

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_ORCH.P6.W1` | Store scheduled work and instructions in the durable assignment ledger; heartbeat carries only a job ID and idempotency key. | Repeated pulse resolves to one assignment and one execution lineage. |
| `MC_ORCH.P6.W2` | Define `NO_WORK`, `CLAIMED`, `RUNNING`, `OUTPUT_READY`, `BLOCKED`, and `PAUSED` pulse outcomes. | Worker does not manufacture a conversational answer when no work exists. |
| `MC_ORCH.P6.W3` | Add unchanged-pulse detection, bounded retries, backoff, and one escalation event. | Repeating the same pulse cannot produce an endless warning/reply loop. |
| `MC_ORCH.P6.W4` | Keep interactive reasoning agents separate from routine scheduled workers while allowing both to use the same assignment contract. | UI and receipts identify trigger mode, worker mode, session, and output target. |

Gate for MC_ORCH: work survives model, provider, worker, or orchestrator handoff
without changing intent, duplicating assignments, losing proof, or trapping an
agent in a repeated heartbeat conversation.

## 14. MC_OPS — VPS staging, release, and runtime operations

### MC_OPS.P1 — Isolated engineering sandbox (`PROVEN_BASELINE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_OPS.P1.W1` | Preserve non-root container, read-only root filesystem, dropped capabilities, private database, no Docker socket, and dedicated workspace. | Runtime security inspection. |
| `MC_OPS.P1.W2` | Keep production vault/source exposure read-only or sanitized. | Mount and permission proof. |
| `MC_OPS.P1.W3` | Ensure autonomous sandbox changes cannot mutate live. | Deliberate boundary test. |

### MC_OPS.P2 — Runtime and service register (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_OPS.P2.W1` | Register live, staging, Paperclip, FCC, n8n, database, tunnels, and on-demand agent processes. | Port/process/release/SHA/service mapping. |
| `MC_OPS.P2.W2` | Distinguish stale browser tab, tunnel endpoint, service listener, and actual runtime ownership. | Refresh plus server-side inspection. |
| `MC_OPS.P2.W3` | Add safe status/log access without restart authority. | Operator can diagnose exact failure from cockpit. |

### MC_OPS.P3 — Build, release, and provenance (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_OPS.P3.W1` | Produce immutable release artifact from reviewed commit. | Artifact hash and build receipt. |
| `MC_OPS.P3.W2` | Apply migrations with preflight, transaction, and compatibility checks. | Forward and rollback rehearsal. |
| `MC_OPS.P3.W3` | Keep configuration/secrets external and scoped by environment. | No secret in repo/image/log; config inventory. |

### MC_OPS.P4 — Staging system acceptance (`PARTIAL`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_OPS.P4.W1` | Maintain the accepted functional staging baseline on port 3330 or its registered successor. | `STAGING_ACCEPTANCE_20260715.md` plus current regression. |
| `MC_OPS.P4.W2` | Re-run all loopline gates after integrated changes. | Structured system acceptance report. |
| `MC_OPS.P4.W3` | Verify real successful paths, controlled failures, timeouts, persistence, and audit. | Browser, API, DB, and log evidence. |

### MC_OPS.P5 — Promotion, rollback, and live (`OPERATOR_GATE`)

| Work package | Result | Acceptance evidence |
| --- | --- | --- |
| `MC_OPS.P5.W1` | Prepare promotion plan with source/target SHA, migrations, backup, health, and rollback. | Operator-readable change and risk report. |
| `MC_OPS.P5.W2` | Obtain explicit operator GO for the exact release. | Durable approval bound to artifact hash. |
| `MC_OPS.P5.W3` | Promote without overwriting the last known-good release. | Live end-to-end acceptance and unchanged rollback target. |
| `MC_OPS.P5.W4` | Prove rollback and reboot survival. | Live recovery receipt. |

Gate for MC_OPS: staging is reproducible and isolated; live changes occur only
through an exact operator-approved release with tested recovery.

## 15. Cross-loopline dependency map

| Work object | Must wait for |
| --- | --- |
| Any new assignment | `MC_SRC.P3` entry contract and exact package ID |
| Agent UI closure | `MC_UI.P2` + corresponding `MC_AGT.Px` + `MC_STATE.P2` |
| Paperclip mutation | `MC_CON.P3.W2` + `MC_CTRL.P2` + operator-approved credential boundary |
| n8n execution | `MC_CON.P4.W2` + `MC_CTRL.P2` |
| Browser Agent execution | `MC_CON.P6.W1` + operator approval |
| Automatic Brain closeout | `MC_STATE.P5.W2` operator canonical-source choice |
| Orchestrator fallback | `MC_ORCH.P1` + `MC_CON.P3` + `MC_ORCH.P3.W3` |
| Live promotion | all impacted loopline gates + `MC_OPS.P5.W1` + explicit GO |

## 16. Common agent read-pack

Every worker reads only this common set before package-specific sources:

1. repository `AGENTS.md` and applicable nested instructions;
2. this blueprint, limited to sections 1–6, the assigned parent loop, section 15,
   and this section;
3. the exact assignment record in
   `docs/operations/AGENT_TASK_DISTRIBUTION_LEDGER.md`;
4. `docs/acceptance/STAGING_ACCEPTANCE_20260715.md` for the last proven baseline;
5. only the code, tests, decisions, and evidence explicitly named by the assignment.

The worker must then report:

```yaml
preflight:
  assignment_id:
  blueprint_work_package_id:
  understood_objective:
  repository:
  branch:
  base_sha:
  workspace:
  allowed_write_paths: []
  forbidden_actions: []
  required_proof: []
  conflicts_or_unknowns: []
```

If repo, branch, scope, authority, dependency, or write surface conflicts, the
worker stops before mutation and records the conflict in the same assignment.

## 17. Delegation pattern

One assignment should normally contain one work package. Closely coupled
packages may be grouped only when they share the same write surface and gate.

Recommended independent lanes:

| Lane | Suitable work | Must not overlap |
| --- | --- | --- |
| Repository analyst | source/register/diff/dependency mapping | implementation files |
| Connector builder | one adapter and its API routes/tests | another agent editing common connector contract |
| UI builder | one bounded page/component surface | persistence schema unless assigned together |
| Persistence builder | one migration/repository/test set | live data or production migration |
| Runtime verifier | read-only staging/browser/database proof | source mutation |
| Security reviewer | authority, secrets, isolation, bypass tests | feature implementation being independently reviewed |
| Integrator | accepted commits and combined regression | speculative redesign |

Capacity exhaustion creates `EXHAUSTED_HANDOFF` on the same assignment. The next
worker receives the unchanged objective, current SHA, output paths, evidence,
open blocker, and remaining acceptance checks.

## 18. Immediate controlled sequence after acceptance

1. Close `MC_SRC.P1.W2`: accept or correct this blueprint.
2. Execute `MC_SRC.P1.W1` and `MC_SRC.P2.W1–W2`: finish the source and repository
   classification without deleting or moving evidence.
3. Close `MC_SRC.P3.W1–W4`: make the read-pack, assignment preflight, and closeout
   executable and test them with two different agents.
4. Re-run `MC_OPS.P4.W1` to verify the 2026-07-15 staging baseline still holds.
5. Close Gemini (`MC_AGT.P7`) or explicitly defer it.
6. Select one bounded integration lane: Paperclip, n8n, Shared Brain canonical
   promotion, or Browser Agents. Do not open all four write bridges together.
7. Integrate only accepted packages, re-run affected gates, and update evidence.
8. Prepare live promotion only after all selected release-scope gates close.

## 19. Blueprint acceptance checklist

Dennis should accept this blueprint only if:

- the eight looplines represent the complete Mission Control project;
- no ViREON or PortMontage content has been imported as Mission Control scope;
- the product outcome matches the cockpit he intends to operate;
- current proof is not overstated;
- blocked integrations show the exact missing authority or bridge;
- the phase order is useful for controlled construction;
- work packages are small and exact enough to outsource;
- every package has a visible acceptance gate;
- an agent can continue after capacity exhaustion from files rather than chat;
- live deployment remains a joint explicit action.

Acceptance changes the status at the top to `OPERATOR_ACCEPTED`. Corrections are
made in this file and retained in Git history; they do not create another
parallel declaration.
