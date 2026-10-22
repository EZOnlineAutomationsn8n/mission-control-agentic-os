# END_PRODUCT_RECONSTRUCTION_POLICY_V1

Agentic OS / Mission Control is being reconstructed into a user-operable end product.

This project must not be steered by minimal/demo/status-baseline thinking. The target is a functional cockpit that can become sellable after verified user workflows are operational.

## Product target

Agentic OS is an operator cockpit for multiple agent systems.

The user must be able to:
- open the app;
- see real agent work panes;
- type into usable agents;
- click Send / Run;
- see output/history in the same pane;
- approve/reject pending work;
- see Evidence / Logs;
- use Work Queue and Registry without fake progress.

## Definition of done

A feature is done only when the user can operate it from the browser UI.

Valid proof:
- user opens the page;
- user types or clicks the intended control;
- the system returns useful output;
- the action is visible in Evidence / Logs when applicable.

Invalid proof:
- route exists;
- healthcheck passes;
- curl works only;
- backend call works but UI is unusable;
- card displays data but cannot be operated;
- disabled buttons are shown as product functionality.

## Core interaction rule

If a real safe action exists:
- expose it as input → Send/Run → output/history.

If no real safe action exists:
- do not show a fake Send button;
- do not show a fake terminal;
- show the exact missing integration.

## Current connector maturity

### Claude Code Agent via FCC Model Gateway

Target: first ready-to-use agent work pane.

Canonical boundary:
- FCC Model Gateway is the model router on VPS port 8082.
- FCC Route Tester is diagnostic raw-model infrastructure only.
- Claude Code Agent is the actual CLI agent with workspace, instructions, tools, and a resumable session.
- A raw FCC response must never be reported as Claude Code agent success.

Required end state:
- one Claude Code Agent Terminal on Home;
- explicit Start Claude Code action;
- persistent Claude Code session ID;
- correct Mission Control worktree and project instructions;
- input  Send to Claude Code! agent output/history;
- agent identity shown separately from FCC gateway and backing-model evidence;
- stop and resume lifecycle;
- Evidence event on start, turn, stop, and failure.

### Hermes

Needs integration:
- platform bridge;
- command route;
- contract must leave scaffold-only mode before operator commands are presented.

### OpenClaw

Needs integration:
- safe command endpoint or real console handoff;
- do not wake old main session;
- do not attach tmux;
- do not fake a command surface.

### Obsidian

Needs cockpit read capability:
- search notes;
- list graph metadata;
- list top linked notes;
- no note write unless deliberately wired and audited.

### Paperclip

Needs usable surface:
- open/use available UI;
- then add one safe action if useful and scoped.

### n8n

Needs:
- credential bridge or known safe webhook;
- no guessed trigger paths.

### AGY Orchestrator

Available:
- project context read/refresh.

Needs:
- explicit job-dispatch endpoint before orchestration controls are shown.

### Browser Agents

Needs:
- CDP/runtime wiring before browser control is shown.

## Forbidden product direction

Do not rebuild the old direction:
- no status-first doctrine;
- no disabled command surface as product policy;
- no minimum-viable framing;
- no demo-baseline claims;
- no fake success;
- no fake Send buttons;
- no “connected means usable” logic.

## Required language

Use:
- END PRODUCT RECONSTRUCTION;
- USER-OPERABLE;
- FUNCTIONAL COCKPIT;
- AGENT WORK PANE;
- INPUT → SEND → OUTPUT;
- READY TO USE only after browser UI proof;
- NEEDS INTEGRATION;
- NOT YET WIRED;
- CONNECTED BUT NOT USABLE;
- ACTION REQUIRED for exact missing pieces only.

## Storage lifecycle closeout

OWNER_CLOSEOUT_CONTRACT=docs/operations/PEA_PORTFOLIO_ARCHIVE_MARKER_ADOPTION_001_20261016/MC_STORAGE_LIFECYCLE_CLOSEOUT_V1.md

Every bounded build/stage closeout must record STORAGE_LIFECYCLE_CLASS.
Only source-proven retired child artifacts may use COLD_ARCHIVE.
For COLD_ARCHIVE, emit the owner-local ARCHIVE_LIFECYCLE.json defined by the contract above with cleanup_eligible=false.

Do not classify by age alone.
Protect the current live release source, current rollback/undo candidate, active staging or preview, open acceptance/re-entry lanes, mutable runtime state, protected configuration, latest proof/checkpoint and unknown data.

The existing Windows VPS Cold Archive Lifecycle remains the single transfer mechanism.
Mission Control must not create its own archive scheduler or copy service.
Source deletion remains separately authorized.

