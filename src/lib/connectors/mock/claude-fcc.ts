import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { FccLiveStatus } from "../live/fcc-status-types";

// ─────────────────────────────────────────────────────────────────────────
// FCC — second real (partial) connector: live detection wired; command channel pending integration.
//
// Important correction: FCC is NOT "Sonnet". free-claude-code is a
// provider-agnostic proxy; its runtime lane here is the coding-first model route via the
// OpenRouter free lane. Claude Code/Sonnet may be the tool editing this
// repo, but it is not the FCC runtime target — never label FCC as Sonnet.
//
// `getState()` fetches read-only health from GET /api/connectors/fcc/status,
// backed by src/lib/connectors/live/fcc-status.ts (server-side: a local
// HTTP GET to FCC's own /health endpoint + a file-presence check — never a
// prompt/command to FCC, never .env/secret reads). If the live read fails,
// this falls back to the underlying mock transport, clearly labeled "mock
// stream" rather than "live status".
//
// Hard constraint honored here: commandExecution is ALWAYS false for FCC,
// in both the live and fallback branches. sendCommand/start/pause/resume/
// stop are no-ops — nothing is ever dispatched to the real FCC process.
//
// ─── REAL ADAPTER ATTACHMENT POINT (next step, not this pass) ──────────
// To wire real command execution: replace the no-op sendCommand/start/etc. below
// with a transport that talks to FCC's own API surface, gated by an
// explicit operator opt-in and real authentication. Contract: implements
// AgentSystemAdapter.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "claude-fcc",
  name: "Claude Code Agent",
  type: "agent",
  category: "AI Agents",
  connectionModes: ["cli", "api"],
  // "api" because live status is read via FCC's own local HTTP /health
  // endpoint, not a filesystem/process inspection.
  activeMode: "api",
  // Static fallback shown only before the first live check resolves;
  // overridden every poll by the live/fallback logic in getState() below.
  status: "degraded",
  capabilities: [
    "real Claude Code CLI session lifecycle",
    "persistent resumable Claude Code session",
    "FCC Model Gateway health and transport evidence",
  ],
  permissions: ["read-health-endpoint", "read-file-presence"],
  lastSync: "2026-07-08T09:00:00Z",
  memoryWriteObligation: true,
  obsidianWriteTarget: "Reports/claude-fcc",
  realConnectionFields: [
    { key: "cliPath", label: "CLI binary path", placeholder: "/usr/local/bin/claude", kind: "path" },
    { key: "apiKey", label: "API key", placeholder: "sk-ant-•••••", kind: "secret" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "FCC Model Gateway (OpenRouter free lane)",
  initialRunState: "running",
  taskLines: [
    "refactoring connector registry pattern",
    "writing unit tests for adapter factory",
    "reviewing OpenClaw retry-backoff PR",
    "drafting session summary note",
  ],
  streamLines: [
    "reading src/lib/connectors/registry.ts",
    "applying edit to shared.ts",
    "running typecheck… 0 errors",
    "drafting handover note for OpenClaw",
  ],
  seedLogs: [
    { level: "info", agentId: "claude-fcc", message: "session attached to repo mission-control", sourceRef: null },
  ],
  seedReports: [
    {
      agentId: "claude-fcc",
      title: "Session summary — 2026-07-07",
      kind: "summary",
      savedToBrain: true,
      brainPath: "Reports/claude-fcc/session-summary-2026-07-07.md",
      excerpt: "Completed refactor of the connector registry pattern. Left follow-ups for OpenClaw.",
    },
  ],
  seedApprovals: [
    {
      agentId: "claude-fcc",
      requestedCapability: "run-shell: npm publish",
      context: "Wants to publish internal package @vrn/connector-kit to registry.",
      riskLevel: "medium",
      status: "pending",
    },
  ],
  readActions: ["read-health-endpoint", "read-file-presence"],
  writeActions: ["write-report"],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/fcc/status";

function toStatusDetail(live: FccLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    service: live.service,
    "health reachable": live.healthReachable ? "yes" : "no",
    "http status": live.httpStatus !== null ? String(live.httpStatus) : "n/a",
    provider: live.provider,
    "default route": "#1 Laguna M.1 (coding-first order)",
    "model route": live.modelRoute,
    "agent bridge": "none — raw model completion, no Claude Code agent session wired",
    "agent execution": "explicit start! CLI turn! persistent resume",
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) {
    detail.notes = live.errors.join("; ");
  }
  return detail;
}

async function fetchLiveStatus(): Promise<FccLiveStatus | null> {
  if (typeof window === "undefined") return null; // never fetch during SSR
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as FccLiveStatus;
  } catch {
    return null;
  }
}

export const claudeFccAdapter: AgentSystemAdapter = {
  ...base,

  async getState(): Promise<AgentSystemState> {
    const baseState = await base.getState();
    const live = await fetchLiveStatus();

    if (!live) {
      // Live read unavailable — fall back to the mock transport as-is.
      // Never claim live status when we couldn't confirm it, and never
      // offer the controlled action when we can't even confirm the
      // service is reachable.
      return {
        ...baseState,
        status: "unknown",
        runState: "blocked",
        health: "warn",
        currentTask: "Runtime status unknown: live status API unavailable",
        commandExecution: false,
        outputKind: "live-status",
        statusDetail: { "runtime observation": "unknown", "reason": "Mission Control could not read the live status API" },
        controlledAction: null,
      };
    }

    const runState: RunState =
      live.status === "connected" ? "running" : live.status === "degraded" ? "error" : live.status === "unknown" ? "blocked" : "stopped";

    return {
      ...baseState,
      status: live.status,
      runState,
      health: live.status === "connected" ? "ok" : live.status === "degraded" || live.status === "unknown" ? "warn" : "fail",
      currentTask: `Health ${live.healthReachable ? "reachable" : "unreachable"} (${live.status}) — ${live.source}`,
      modelOrService: live.modelRoute,
      connectorMode: "api",
      commandExecution: false,
      outputKind: "live-status",
      statusDetail: toStatusDetail(live),
      // One-time, explicitly-scoped controlled override (see
      // src/lib/connectors/live/fcc-actions.ts): a single plain-text
      // prompt action, submitted only by explicit operator form
      // submission on /systems/claude-fcc. This is distinct from
      // commandExecution/sendCommand, which stay disabled — this is not a
      // general command channel, just one reviewed, single-purpose action.
      controlledAction: {
        id: "claude-code-agent",
        label: "Claude Code Agent Terminal",
        endpoint: "/api/connectors/claude-code/actions/ask",
      },
      capabilities: [
        { kind: "status", available: true },
        { kind: "controlledPrompt", available: true, reason: "one-time controlled override — text only, no tools" },
      ],
    };
  },

  // Run controls (start/pause/resume/stop) and sendCommand remain hard
  // no-ops — the one controlled action lives entirely behind the separate
  // /api/connectors/fcc/actions/ask route + ControlledActionPanel UI, not
  // through this adapter's command surface. None of these ever reach the
  // real FCC process — inert no-ops regardless of what the UI does, as a
  // defense-in-depth backstop behind the commandExecution=false UI gating.
  async sendCommand() {
    return;
  },
  async start() {
    return;
  },
  async pause() {
    return;
  },
  async resume() {
    return;
  },
  async stop() {
    return;
  },
};
