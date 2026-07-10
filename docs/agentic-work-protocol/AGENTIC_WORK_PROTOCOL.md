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

Product owner and final decision maker for high-impact changes.

Dennis confirms:
- what the real goal is
- whether the output feels right
- whether a hot-zone change may proceed
- whether automation is allowed

### Claude Code

Lead builder.

Claude Code is responsible for:
- inspecting the repo
- writing implementation specs
- proposing safe implementation steps
- making code changes only after approval when required
- running verification
- reporting proof

### Codex

Reviewer and verifier by default.

Codex is responsible for:
- reviewing implementation specs
- finding hidden assumptions
- checking risk zones
- verifying that planned changes match repo state
- acting as backup implementer only when explicitly promoted

### ChatGPT

Command filter, continuity layer, and regie.

ChatGPT is responsible for:
- translating agent plans into safe execution blocks
- checking outputs
- preparing handovers
- keeping work aligned with the current project state

### AGY

Future orchestrator.

AGY should coordinate lanes, task state, pending work, and agent handoff once wired into Mission Control.

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

AGY should eventually orchestrate lane assignment and task state.

ViREON should enforce governance boundaries and proof requirements.

Obsidian should store durable decisions, handovers, and gotchas.

---

## Current project defaults

Default builder:
- Claude Code

Default reviewer:
- Codex

Default command filter:
- ChatGPT

Default orchestrator target:
- AGY

Default visual verifier target:
- Browser Agents via local CDP

Default governance layer:
- ViREON

Default memory/proof layer:
- Obsidian

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
