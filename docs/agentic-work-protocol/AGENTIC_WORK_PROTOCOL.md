# Agentic Work Protocol

Date: 2026-07-10  
Scope: Mission Control, Claude Code, Codex, AGY, Browser Agents, ViREON, Obsidian  
Status: canonical working protocol

## Purpose

This protocol defines how agentic work must start, split, verify, document, and only then automate.

Mission Control is not just a dashboard. It is the cockpit for an agentic work system.

The core rule:

Do not start with building. Start with understanding, planning, verification, and role separation.

---

## Roles

### Dennis

Owner of intent, priorities, scope, and final authority for high-impact changes.

Dennis is not expected to manually orchestrate every worker or translate every
objective into technical subtasks. The orchestration layer must absorb that
coordination work and return decisions, exceptions, and proof.

Dennis confirms:
- what the real goal is
- whether the output feels right
- whether a hot-zone change may proceed
- whether automation is allowed

### Antigravity

Primary execution orchestrator when its capacity is available.

Antigravity is responsible for:
- decomposing approved objectives into bounded assignments
- selecting workers and execution order
- tracking dependencies and handoffs
- collecting worker results and evidence
- escalating exhaustion or blocked capacity instead of silently stalling

### Paperclip

Fallback orchestrator and durable work control plane.

Paperclip is responsible for:
- preserving tasks, runs, approvals, goals, artifacts, and assignment state
- taking over coordination when Antigravity is unavailable or exhausted
- exposing durable work history independently of one agent session

### Codex

Technical overseer, tactical dispatcher, implementer, reviewer, and integrator
inside the active collaboration.

Codex is responsible for:
- understanding the cross-project technical state placed in scope
- splitting independent work across suitable workers
- choosing what should be built, reviewed, or verified independently
- integrating completed sections into one coherent result
- checking evidence and recording exact output locations
- reducing its own scarce-context consumption by delegating bounded work

Codex can perform tactical orchestration for the current task. It does not
replace Antigravity or Paperclip as the durable orchestrator layer.

### Worker pool

Claude Code, Hermes, OpenClaw, Codex sessions, Gemini, and specialized agents
are selectable workers. A product name does not permanently determine a role:
the assignment record states whether that instance is builder, researcher,
reviewer, verifier, or background worker.

### Browser Agents

Visual verification layer.

Browser Agents should allow agents to inspect UI output through a browser/CDP feedback loop instead of building blind.

### ViREON

Governance layer.

ViREON defines policy, approval zones, proof requirements, and runtime governance boundaries.

### Obsidian

Memory and proof store.

Obsidian stores durable notes, proof summaries, decisions, gotchas, and project continuity.

---

## Three independent fallback layers

Fallback must be explicit at three different levels. They must never be
collapsed into one ambiguous "fallback" label.

1. Model fallback — another model serves the same agent runtime.
2. Provider fallback — another provider transports the model request.
3. Orchestrator fallback — another control plane takes over task coordination.

Current orchestrator order:

1. Antigravity — primary orchestrator.
2. Paperclip — durable fallback orchestrator/control plane.
3. Codex — tactical coordination within the current operator collaboration.

An orchestrator handoff must preserve the assignment ID, objective, write
target, current status, dependencies, evidence paths, and remaining authority.

---

## Core workflow

Every non-trivial task follows this sequence:

1. Interview
2. Implementation spec
3. Lane split
4. Verification plan
5. Build
6. Proof
7. Skill or gotchas update
8. Automation review

Automation comes last, not first.

---

## Step 1 — Interview before build

When requirements are unclear, the agent must interview Dennis before building.

The interview should identify:
- the core problem
- who the feature or system is for
- who it is not for
- what success looks like
- what failure looks like
- what decisions affect implementation
- which assumptions need confirmation

The agent should ask clear questions and then summarize the answers into an implementation spec.

---

## Step 2 — Implementation spec before mutation

Before changing code or infrastructure, the agent must produce an implementation spec.

The spec must include:
- problem being solved
- intended outcome
- in scope
- out of scope
- files and services likely affected
- files and services that must not be touched
- key decisions
- default choices
- risks
- verification plan
- rollback or recovery path

No meaningful mutation should happen before the spec is accepted or the task is clearly low-risk.

---

## Step 3 — Lane split / subagents

Work should be split into lanes when tasks are independent or require different perspectives.

Required lanes:

### Builder lane

Implements the approved change.

Typical systems:
- Claude Code
- OpenClaw
- FCC-backed agents

### Reviewer lane

Checks assumptions, code risk, architecture fit, and unintended consequences.

Typical systems:
- Codex
- second Claude session
- static analysis

### Verifier lane

Defines and runs proof.

Typical checks:
- build
- tests
- curl endpoints
- connector status
- port checks
- browser/CDP checks
- runtime proof
- git diff and status

### Governance / Memory lane

Records decisions, proof, gotchas, and durable knowledge.

Typical systems:
- ViREON
- Obsidian
- docs
- ProofLedger or audit trail

---

## Step 4 — Verify before build

Before building, the agent must state how the result will be verified.

After building, the agent must run verification and report exact proof.

Verification should be specific to the task.

Examples:
- code change: build, tests, diff, runtime endpoint
- connector change: status endpoint, process check, logs
- UI change: browser/CDP inspection, screenshot, page response
- model routing change: source check, runtime check, forbidden fallback check
- documentation change: file diff and scope check

A task is not complete until verification has run or the agent clearly explains why verification could not run.

---

## Step 5 — Human validation zones

Some areas require human approval before mutation.

Hot zones include:
- paid/free model routing
- governance policy
- authentication and secrets
- database schema or data writes
- destructive cleanup
- deploy and DNS changes
- external integrations
- production workflows
- anything with high cost of error

Low-risk areas can move faster, but must still have a proof path.

High-risk areas require Dennis approval before implementation.

---

## Step 6 — Skills from repeated work

Skills should not be invented abstractly.

A skill should be created after a real workflow has been performed manually and proven useful.

A skill should include:
- when to use it
- when not to use it
- required inputs
- exact process
- verification steps
- gotchas
- expected output format

The question is not: what skill should we invent?

The question is: should this proven process become a skill?

---

## Step 7 — Gotchas

Every repeated mistake should become a gotcha.

Gotchas are:
- edge cases
- recurring failures
- style traps
- tool limitations
- wrong assumptions
- proof gaps
- context handoff failures

Agents should update relevant gotchas after a task exposes a repeatable mistake.

---

## Step 8 — Automation review

Automation is allowed only after review.

Before automation, run two checks:

### Taste test

Does the task require human judgment, taste, or qualitative assessment?

If yes, augment it instead of fully automating it.

### 80/20 test

If the output is only 80 percent as good as a careful human result, is that acceptable?

If yes, it may be an automation candidate.

If no, keep a human validation step.

---

## Automation candidates

Good candidates:
- health snapshots
- connector status reports
- git status checks
- endpoint checks
- log summaries
- proof bundle generation
- recurring project summaries
- low-risk documentation refreshes

Poor candidates without human review:
- code mutation
- governance changes
- model routing changes
- database writes
- cleanup/delete operations
- deploy changes
- external account changes

---

## Mission Control implementation target

Mission Control should represent this protocol as a cockpit with lanes:

1. Builder
2. Reviewer
3. Verifier
4. Governance / Memory

Each lane should show:
- assigned agent or system
- current task
- current state
- pending decision
- proof status
- last output
- related files or docs

Browser Agents should become the visual verification layer for UI and browser-based checks.

Antigravity owns primary lane assignment and task coordination; Paperclip must
preserve the same assignment state and take over when the primary orchestrator
is exhausted or unavailable.

ViREON should enforce governance boundaries and proof requirements.

Obsidian should store durable decisions, handovers, and gotchas.

---

## Current project defaults

Default orchestrator:
- Antigravity

Orchestrator fallback:
- Paperclip

Tactical dispatcher and integrator:
- Codex

Builder, researcher, reviewer, and verifier:
- selected per assignment from the available worker pool

Default visual verifier target:
- Browser Agents via local CDP

Default governance layer:
- ViREON

Default memory/proof layer:
- Shared Brain / Obsidian

Canonical assignment register:
- `docs/operations/AGENT_TASK_DISTRIBUTION_LEDGER.md`

---

## Required agent behavior

Agents must:

1. Clarify unclear requirements before building.
2. Produce an implementation spec before meaningful mutation.
3. Split independent work into lanes where useful.
4. Define verification before implementation.
5. Run verification after implementation.
6. Report proof, not just claims.
7. Identify hot zones before touching them.
8. Create or update skills only from proven workflows.
9. Add gotchas when repeatable mistakes occur.
10. Treat automation as the final step, not the first step.
