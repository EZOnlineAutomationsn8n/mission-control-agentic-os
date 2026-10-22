import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { OpenClawLiveStatus } from "../live/openclaw-status-types";

// ─────────────────────────────────────────────────────────────────────────
// OPENCLAW — third real (partial) connector: live detection wired; command channel pending integration.
//
// `getState()` fetches read-only status from GET /api/connectors/openclaw/
// status, backed by src/lib/connectors/live/openclaw-status.ts (server-
// side: a local HTTP GET to OpenClaw's own /health endpoint + a pure
// /proc/<pid>/cmdline scan — never a prompt/command to OpenClaw, never a
// session attach, never touches the heartbeat loop or the old main
// session). If the live read fails, this falls back to the underlying
// mock transport, clearly labeled "mock stream" rather than "live status".
//
// Hard constraint honored here: commandExecution is ALWAYS false for
// OpenClaw, in both the live and fallback branches. sendCommand/start/
// pause/resume/stop are no-ops — nothing is ever dispatched to the real
// OpenClaw gateway, no session is ever opened, no heartbeat is ever
// enabled from this UI.
//
// ─── REAL ADAPTER ATTACHMENT POINT (next step, not this pass) ──────────
// To wire real command execution: replace the no-op sendCommand/start/etc. below
// with a transport that talks to OpenClaw's own gateway API, gated by an
// explicit operator opt-in and real authentication — do not wire that up
// silently, and do not wake the old main session. Contract: implements
// AgentSystemAdapter.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "openclaw",
  name: "OpenClaw",
  type: "agent",
  category: "Automation",
  connectionModes: ["cli", "webhook", "api"],
  // "api" because live status is read via OpenClaw's own local HTTP
  // /health endpoint, not a filesystem/process inspection.
  activeMode: "api",
  // Static fallback shown only before the first live check resolves;
  // overridden every poll by the live/fallback logic in getState() below.
  status: "degraded",
  capabilities: [
    "live gateway status (read-only)",
    "process liveness detection",
    "no direct command channel (integration pending)",
  ],
  permissions: ["read-health-endpoint", "read-proc-cmdline"],
  lastSync: "2026-07-08T07:55:00Z",
  memoryWriteObligation: true,
  obsidianWriteTarget: "Reports/openclaw",
  realConnectionFields: [
    { key: "cliPath", label: "CLI binary path", placeholder: "/opt/openclaw/bin/openclaw", kind: "path" },
    { key: "gatewayUrl", label: "Gateway URL", placeholder: "https://openclaw.internal/gw", kind: "url" },
    { key: "apiKey", label: "API key", placeholder: "oc_•••••", kind: "secret" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "OpenClaw gateway (workbench/toolchain)",
  initialRunState: "waiting-approval",
  taskLines: [
    "implementing retry backoff on webhook adapter",
    "reviewing handover from FCC Model Gateway",
    "waiting on operator approval for infra change",
  ],
  streamLines: [
    "picked up handover Handovers/handover-fcc-to-openclaw-01.md",
    "drafted patch: exponential backoff, max 5 retries",
    "blocked: requires approval for infra permission",
  ],
  seedLogs: [
    { level: "warn", agentId: "openclaw", message: "blocked pending operator approval", sourceRef: null },
  ],
  seedReports: [],
  seedApprovals: [
    {
      agentId: "openclaw",
      requestedCapability: "manage-webhooks: modify production webhook retry policy",
      context: "Implementing retry/backoff handover from FCC Model Gateway session SESSION-0002.",
      riskLevel: "high",
      status: "pending",
    },
  ],
  readActions: ["read-health-endpoint", "read-proc-cmdline"],
  writeActions: ["write-repo", "manage-webhooks"],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/openclaw/status";

function toStatusDetail(live: OpenClawLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    service: live.service,
    "gateway reachable": live.gatewayReachable ? "yes" : "no",
    "http status": live.httpStatus !== null ? String(live.httpStatus) : "n/a",
    "pid alive": live.pidAlive === null ? "not visible across container boundary" : live.pidAlive ? "yes" : "no",
    "command execution": "not commandable — no safe command endpoint wired",
    heartbeat: live.heartbeat,
    "old main session": live.oldMainSession,
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) {
    detail.notes = live.errors.join("; ");
  }
  return detail;
}

async function fetchLiveStatus(): Promise<OpenClawLiveStatus | null> {
  if (typeof window === "undefined") return null; // never fetch during SSR
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as OpenClawLiveStatus;
  } catch {
    return null;
  }
}

export const openClawAdapter: AgentSystemAdapter = {
  ...base,

  async getState(): Promise<AgentSystemState> {
    const baseState = await base.getState();
    const live = await fetchLiveStatus();

    if (!live) {
      // Live read unavailable — fall back to the mock transport as-is.
      // Never claim live status when we couldn't confirm it.
      return {
        ...baseState,
        status: "unknown",
        runState: "blocked",
        health: "warn",
        currentTask: "Runtime status unknown: live status API unavailable",
        commandExecution: false,
        outputKind: "live-status",
        statusDetail: { "runtime observation": "unknown", "reason": "Mission Control could not read the live status API" },
      };
    }

    const runState: RunState =
      live.status === "connected" ? "running" : live.status === "degraded" ? "error" : live.status === "unknown" ? "blocked" : "stopped";

    return {
      ...baseState,
      status: live.status,
      runState,
      health: live.status === "connected" ? "ok" : live.status === "degraded" || live.status === "unknown" ? "warn" : "fail",
      currentTask: `Gateway ${live.gatewayReachable ? "reachable" : "unreachable"} (${live.status}) — ${live.source}`,
      connectorMode: "api",
      commandExecution: false,
      outputKind: "live-status",
      statusDetail: toStatusDetail(live),
      capabilities: [
        { kind: "status", available: true },
        { kind: "blocked", available: true, reason: "action blocked: no safe controlledPrompt endpoint exposed" },
      ],
    };
  },

  // Hard constraint: OpenClaw has no command channel wired yet. None of
  // these ever reach the real gateway, open a session, or touch the
  // heartbeat loop — inert no-ops regardless of what the UI does, as a
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
