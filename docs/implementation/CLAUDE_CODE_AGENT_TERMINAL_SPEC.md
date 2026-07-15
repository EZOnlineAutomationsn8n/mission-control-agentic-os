# Claude Code Agent Terminal  Implementation Specification

## Problem

Mission Control currently labels a raw FCC model request as Free Claude Code.
That route proves only that the FCC model gateway can return a completion. It
does not start, resume, or interact with the Claude Code agent.

## Canonical objects

- **FCC Model Gateway**  local Anthropic-compatible model router on port 8082.
- **FCC Route Tester**  diagnostic raw model request; never an agent session.
- **Claude Code via FCC Launcher**  starts the Claude Code CLI with FCC as its model gateway.
- **Claude Code Agent**  the actual CLI agent with workspace, instructions, tools, and session state.
- **Claude Code Agent Terminal**  the Mission Control operator pane for that agent.

## In scope

- Preserve the existing FCC route order and raw route API as diagnostics.
- Add a server-side Claude Code session store.
- Start a real Claude Code CLI session through the existing FCC launcher.
- Pin the agent to the Mission Control Codex worktree.
- Load project/user/local Claude Code settings and project instructions.
- Support explicit start, prompt/resume, and stop lifecycle actions.
- Persist conversation entries, session metadata, and audit events.
- Show agent identity separately from FCC transport/model evidence.
- Render the real Claude Code Agent Terminal directly on Home.

## Out of scope

- Live deployment on port 3300.
- FCC route-order, credential, or provider changes.
- Hermes, OpenClaw, AGY, Paperclip, n8n, or Shared Brain integration.
- Unrestricted root-level tool access.
- A persistent PTY process; this pass uses Claude Code print-mode turns with a
  persistent/resumable Claude Code session ID.

## Execution model

The FCC gateway remains continuously available. A Claude Code session is
explicitly started from the cockpit. Each turn launches the real Claude Code
CLI in print mode and either creates or resumes the persisted Claude Code
session. The process exits after the turn while the session remains resumable.
The UI must describe this honestly as an on-demand CLI process with persistent
session state, not as an always-running terminal process.

## Safety defaults

- Workspace is restricted to the configured Mission Control agent worktree.
- Default permission mode is `acceptEdits`; commands that still require
  interactive approval are not silently bypassed.
- No deployment or service-management tools are granted by this bridge.
- Session start/stop and prompts require explicit operator actions.
- Secrets are inherited only inside the existing server-side launcher and are
  never returned to the browser.

## Files allowed to change

- `docs/implementation/CLAUDE_CODE_AGENT_TERMINAL_SPEC.md`
- `AGENTS.md`
- `AGENTIC_OS_BUILD_POLICY.md`
- `src/lib/claude-code/**`
- `src/lib/agent-conversations/**`
- `src/app/api/connectors/claude-code/**`
- `src/components/control-room/AgentConversationPanel.tsx`
- `src/components/control-room/AgentWindow.tsx`
- `src/components/control-room/ControlRoom.tsx`
- `src/lib/connectors/mock/claude-fcc.ts`
- `src/app/page.tsx`
- focused tests and package scripts
- external launcher `/opt/vireon/workfloor/bin/start_claude_fcc.sh` after backup

## Files that must not change

- FCC provider credentials and route order.
- Live release under `/opt/vrn/mission-control/builds/agentic-os-v1`.
- Live service configuration and port 3300.

## Verification
