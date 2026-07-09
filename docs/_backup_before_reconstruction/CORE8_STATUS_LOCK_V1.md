# Core-8 Connector Lock — V1

Policy: [AGENTIC_OS_BUILD_POLICY.md](../AGENTIC_OS_BUILD_POLICY.md) — `STATUS_ONLY_CONNECTOR_PROFILE_V1`

**Timestamp:** 2026-07-09T00:00:00Z (supersedes [CORE4_STATUS_LOCK_V1.md](CORE4_STATUS_LOCK_V1.md))

This report documents the current live-status baseline: all eight registered connectors — Hermes, FCC / OwlAlpha, OpenClaw, Obsidian Graphlink, Paperclip, n8n, AGY Orchestrator, and (as of this pass) Browser Agents — now report real, read-only, status-only state. Nothing beyond status detection is implemented for any of them.

## Current connector baseline

| Connector | Mode | Status | Command execution |
|---|---|---|---|
| Hermes | LIVE STATUS | degraded | disabled (status-only) |
| FCC / OwlAlpha | LIVE STATUS | connected | disabled (status-only) |
| OpenClaw | LIVE STATUS | connected | disabled (status-only) |
| Obsidian — Shared Brain / Graphlink | LIVE STATUS | connected | disabled (status-only) |
| Paperclip | LIVE STATUS | connected | disabled (status-only) |
| n8n | LIVE STATUS | connected | disabled (status-only) |
| AGY Orchestrator | LIVE STATUS | connected | disabled (status-only) |
| Browser Agents | LIVE STATUS | disconnected | disabled (status-only) |

Hermes reads `degraded` for the same reason recorded in Core-4: its gateway process is alive but its OpenRouter integration contract is `SCAFFOLD_ONLY`. Browser Agents reads `disconnected` for an equally honest reason — no CDP endpoint (`127.0.0.1:9222`) or browser automation process was found running on this host during recon, so the connector correctly reports "not attached" rather than fabricating a connected state.

## What changed in this pass

Only Browser Agents moved, from mock/`pending-setup` to a real live-status connector:

- `src/lib/connectors/live/browser-agents-status-types.ts` — pure types
- `src/lib/connectors/live/browser-agents-status.ts` — server-only reader
- `src/app/api/connectors/browser-agents/status/route.ts` — `force-dynamic` route handler
- `src/lib/connectors/mock/browser-agents.ts` — adapter now fetches live status client-side via `getState()`, same pattern as Paperclip/n8n/AGY

Paperclip, n8n, and AGY were already live-status connectors going into this pass (built in prior passes not covered by Core-4's report); this report brings the written record in line with actual code state.

## Browser Agents reader — how it checks

- GETs the standard Chrome DevTools discovery endpoint `http://127.0.0.1:9222/json/version` (short timeout, 1.5s) — returns only non-secret browser/product metadata (`Browser`, `webSocketDebuggerUrl`) when reachable.
- Never opens a CDP WebSocket, never issues a CDP command, never reads page/tab content, never touches profile data.
- Checks `profilePathExists` only if an operator has supplied a real `profilePath` via the (currently empty) `realConnectionFields` settings — no path is guessed or assumed.
- If unreachable, reports `disconnected` with the reason in `errors`.

## Safety guarantees (unchanged, now covering all eight)

- **No command execution** — `sendCommand`/`start`/`pause`/`resume`/`stop` are hard no-ops on all eight adapters, regardless of UI state, as a defense-in-depth backstop behind `commandExecution: false` UI gating.
- **No secrets read** — no reader touches API keys, tokens, or credential values.
- **No `.env` values read.**
- **No tmux/session attach, no service restarts, no heartbeat loops enabled.**
- **No page/tab content, note content, or database rows read** by any reader — only status, health, and metadata.

## Remaining mock/pending connectors

None from the original Core-8 build-order list. Everything in `src/mocks/future-connectors.ts` remains explicitly out of scope (registry-visible placeholders only, not `AgentSystemAdapter` implementations).

## Next candidates (in order, still status-only-first per policy)

1. A new capability pass on top of the Core-8 baseline (e.g. Work Queue routing, Approvals Center audit trail wiring, or Shared Brain write-back) — since every planned connector in `AGENTIC_OS_BUILD_POLICY.md`'s "Current connector sequence" is now live-status.
2. Any connector from `future-connectors.ts`, promoted one at a time, status-only first.

Per `AGENTIC_OS_BUILD_POLICY.md`, command execution, service mutation, tmux attach, session wake-up, secret reading, or layout redesign require explicit user override before any future pass touches them.
