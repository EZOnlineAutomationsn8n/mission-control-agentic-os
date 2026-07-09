# Core-4 Connector Lock — V1

Policy: [AGENTIC_OS_BUILD_POLICY.md](../AGENTIC_OS_BUILD_POLICY.md) — `STATUS_ONLY_CONNECTOR_PROFILE_V1`

**Timestamp:** 2026-07-09T00:41:56Z

This report documents the stable live-status baseline reached after Hermes, FCC / OwlAlpha, OpenClaw, and Obsidian Graphlink were each connected as real, read-only, status-only connectors. Nothing beyond status detection was implemented for any of them.

## Current connector baseline

| Connector | Mode | Status | Command execution |
|---|---|---|---|
| Hermes | LIVE STATUS | degraded | disabled (status-only) |
| FCC / OwlAlpha | LIVE STATUS | connected | disabled (status-only) |
| OpenClaw | LIVE STATUS | connected | disabled (status-only) |
| Obsidian — Shared Brain / Graphlink | LIVE STATUS | connected | disabled (status-only) |

Hermes reads as `degraded` because its gateway process is genuinely alive but its OpenRouter integration contract is still `SCAFFOLD_ONLY` — this is a correct reflection of real system state, not a detection failure.

## API routes now present

- `/api/connectors/hermes/status`
- `/api/connectors/fcc/status`
- `/api/connectors/openclaw/status`
- `/api/connectors/obsidian/status`

Each is a `force-dynamic` Next.js route handler backed by a server-only reader under `src/lib/connectors/live/`, called from its adapter's `getState()` via client-side `fetch`. None are cached; each reflects the current-moment check.

## Safety guarantees

- **No command execution** — `sendCommand`/`start`/`pause`/`resume`/`stop` are hard no-ops on all four adapters, regardless of UI state, as a defense-in-depth backstop behind the `commandExecution: false` UI gating (disabled input, disabled controls).
- **No secrets read** — no reader touches API keys, tokens, or credential values.
- **No `.env` values read** — variable *names* were referenced only during read-only inventory (outside this codebase); none of the four readers open any `.env` file.
- **No tmux/session attach** — no reader attaches to a tmux session, an agent session, or a terminal. OpenClaw's old main session and Hermes' tmux session were never touched.
- **No service restarts** — no reader starts, stops, restarts, or signals any service.
- **No heartbeat enabled** — OpenClaw's heartbeat loop was never queried or reactivated; its status field is a static declarative value, not a live probe.
- **No Obsidian note content read** — the Obsidian reader only checks vault/marker path existence and a `.md` file *count* (capped, metadata only); no filenames, titles, or note bodies are ever read or exposed.

## UI surfaces verified

- `/` (Operator Home — Core 4 cockpit)
- `/systems/hermes`
- `/systems/claude-fcc`
- `/systems/openclaw`
- `/systems/obsidian`
- `/registry`

All six were confirmed via runtime screenshots showing the correct LIVE STATUS badges, disabled command inputs/controls, and matching status-detail fields, with no secrets displayed anywhere.

## Remaining mock connectors

- Paperclip
- n8n
- AGY Orchestrator
- Browser Agents

All four still report `status: "mock"` in `/registry` and have not been touched by any live-status work.

## Next connector candidates (in order)

1. Paperclip — status-only
2. n8n — status-only
3. AGY Orchestrator — status-only
4. Browser Agents — status-only

Per `AGENTIC_OS_BUILD_POLICY.md`, each future pass proceeds status-only by default; command execution, service mutation, tmux attach, session wake-up, secret reading, or layout redesign require explicit user override.
