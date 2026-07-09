import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { N8nLiveStatus } from "../live/n8n-status-types";

// ─────────────────────────────────────────────────────────────────────────
// N8N — live detection wired. Workflow triggering is intentionally NOT wired
// in this pass (that's a write action against a real system, out of scope
// until a safe webhook is allowlisted) — capabilities report
// workflowTrigger as blocked/unavailable.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "n8n",
  name: "n8n",
  type: "automation",
  category: "Automation",
  connectionModes: ["api", "webhook"],
  activeMode: "api",
  status: "degraded",
  capabilities: ["workflow automation", "scheduled syncs", "integration glue"],
  permissions: ["read-health-endpoint"],
  lastSync: "2026-07-08T03:00:00Z",
  memoryWriteObligation: true,
  obsidianWriteTarget: "Reports/n8n",
  realConnectionFields: [
    { key: "apiUrl", label: "n8n instance URL", placeholder: "https://n8n.internal", kind: "url" },
    { key: "apiKey", label: "API key", placeholder: "n8n_•••••", kind: "secret" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "n8n workflow engine",
  initialRunState: "idle",
  taskLines: [
    "running nightly project-data sync workflow",
    "polling source registries for updates",
    "dispatching webhook to Paperclip on new upload",
  ],
  streamLines: [
    "workflow 'nightly-sync' started",
    "node 'Fetch registries' completed — 218 rows",
    "workflow 'nightly-sync' completed clean",
  ],
  seedLogs: [{ level: "info", agentId: "n8n", message: "nightly sync completed clean", sourceRef: null }],
  seedReports: [
    {
      agentId: "n8n",
      title: "Nightly sync report — 2026-07-08",
      kind: "report",
      savedToBrain: false,
      brainPath: null,
      excerpt: "218 rows synced from source registries. 0 errors, 2 warnings on stale endpoints.",
    },
  ],
  seedApprovals: [],
  readActions: ["read-health-endpoint"],
  writeActions: [],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/n8n/status";

function toStatusDetail(live: N8nLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    "health reachable": live.healthReachable ? "yes" : "no",
    "http status": live.httpStatus !== null ? String(live.httpStatus) : "n/a",
    "command execution": "not commandable — no safe command endpoint wired",
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) detail.notes = live.errors.join("; ");
  return detail;
}

async function fetchLiveStatus(): Promise<N8nLiveStatus | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as N8nLiveStatus;
  } catch {
    return null;
  }
}

export const n8nAdapter: AgentSystemAdapter = {
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
      // No controlledAction: the trigger endpoint exists but n8n's REST API
      // rejects it (401) and no safe webhook path has been allowlisted. A
      // visible trigger button that always fails is a fake capability — the
      // blocked entry below drives the ACTION REQUIRED panel instead.
      controlledAction: null,
      capabilities: [
        { kind: "status", available: true },
        {
          kind: "workflowTrigger",
          available: false,
          reason:
            "needs credential bridge or safe allowlisted webhook path — n8n REST API returns 401 and no safe test/demo webhook was discovered",
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
