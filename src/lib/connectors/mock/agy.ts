import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { AgyLiveStatus } from "../live/agy-status-types";

// ─────────────────────────────────────────────────────────────────────────
// AGY — live detection + read-only context refresh. Task routing/pause is NOT wired in
// this pass (write actions against a real system) — capabilities report
// projectContext as blocked/unavailable.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "agy",
  name: "AGY Orchestrator",
  type: "orchestrator",
  category: "Orchestrators",
  connectionModes: ["api"],
  activeMode: "api",
  status: "degraded",
  capabilities: ["task routing", "fleet supervision", "load balancing across agents"],
  permissions: ["read-health-endpoint"],
  lastSync: "2026-07-08T09:05:00Z",
  memoryWriteObligation: true,
  obsidianWriteTarget: "Reports/agy",
  realConnectionFields: [
    { key: "apiUrl", label: "AGY API URL", placeholder: "https://agy.internal/api", kind: "url" },
    { key: "apiKey", label: "API key", placeholder: "agy_•••••", kind: "secret" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "AGY orchestrator",
  initialRunState: "idle",
  taskLines: [
    "monitoring fleet health across connected systems",
    "routing blocked task to OpenClaw",
    "rebalancing load — Hermes at 82% capacity",
  ],
  streamLines: [
    "fleet check: systems healthy",
    "routed WORK-0042 to OpenClaw",
    "Hermes queue depth: 3 — within threshold",
  ],
  seedLogs: [{ level: "info", agentId: "agy", message: "fleet bring-up complete", sourceRef: null }],
  seedReports: [],
  seedApprovals: [],
  readActions: ["read-health-endpoint"],
  writeActions: [],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/agy/status";

function toStatusDetail(live: AgyLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    "health reachable": live.healthReachable ? "yes" : "no",
    "http status": live.httpStatus !== null ? String(live.httpStatus) : "n/a",
    service: live.service ?? "unknown",
    "registry ok": live.registryOk === null ? "unknown" : live.registryOk ? "yes" : "no",
    "agents total": live.agentsTotal !== null ? String(live.agentsTotal) : "unknown",
    pending: live.pending !== null ? String(live.pending) : "unknown",
    "command execution": "not commandable — no safe command endpoint wired",
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) detail.notes = live.errors.join("; ");
  return detail;
}

async function fetchLiveStatus(): Promise<AgyLiveStatus | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as AgyLiveStatus;
  } catch {
    return null;
  }
}

export const agyAdapter: AgentSystemAdapter = {
  ...base,

  async getState(): Promise<AgentSystemState> {
    const baseState = await base.getState();
    const live = await fetchLiveStatus();

    if (!live) {
      return { ...baseState, commandExecution: false, outputKind: "mock-stream", statusDetail: null };
    }

    const runState: RunState =
      live.status === "connected" ? "running" : live.status === "degraded" ? "error" : "stopped";

    return {
      ...baseState,
      status: live.status,
      runState,
      health: live.status === "connected" ? "ok" : live.status === "degraded" ? "warn" : "fail",
      currentTask: `Health ${live.healthReachable ? "reachable" : "unreachable"} (${live.status}) — ${live.source}`,
      connectorMode: "api",
      commandExecution: false,
      outputKind: "live-status",
      statusDetail: toStatusDetail(live),
      controlledAction: {
        id: "agy-context",
        label: "AGY project context (read-only refresh)",
        endpoint: "/api/connectors/agy/actions/context",
        requiresInput: false,
      },
      capabilities: [
        { kind: "status", available: true },
        {
          kind: "projectContext",
          available: live.registryOk !== null,
          reason:
            live.registryOk !== null
              ? "fleet registry snapshot via /status (read-only)"
              : "/status endpoint unreachable — no registry snapshot available",
        },
        {
          kind: "blocked",
          available: true,
          reason: "orchestration/job-trigger blocked — no safe job-dispatch endpoint found",
        },
      ],
    };
  },

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
