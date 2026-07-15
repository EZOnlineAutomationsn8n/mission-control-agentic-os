import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { AgyLiveStatus } from "../live/agy-status-types";

const descriptor: ConnectorDescriptor = {
  id: "agy",
  name: "Antigravity",
  type: "agent",
  category: "AI Agents",
  connectionModes: ["cli", "api"],
  activeMode: "cli",
  status: "connected",
  capabilities: ["Agentic AI coding assistance", "persistent sandbox conversation", "workspace-aware tool use"],
  permissions: ["Antigravity sandbox terminal restrictions"],
  lastSync: null,
  memoryWriteObligation: true,
  obsidianWriteTarget: "Reports/antigravity",
  realConnectionFields: [
    { key: "binaryPath", label: "Antigravity CLI path", placeholder: "/root/.local/bin/agy", kind: "path" },
    { key: "workspace", label: "Workspace", placeholder: "/opt/vireon/workfloor", kind: "path" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "Antigravity CLI 1.0.12",
  initialRunState: "idle",
  taskLines: [],
  streamLines: [],
  seedLogs: [],
  seedReports: [],
  seedApprovals: [],
  readActions: ["read-health-endpoint"],
  writeActions: ["run-antigravity-sandbox-turn"],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/agy/status";

function toStatusDetail(live: AgyLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    "agent runtime": "Antigravity CLI 1.0.12",
    "agent role": "Agentic AI coding assistant",
    workspace: "/opt/vireon/workfloor",
    "health reachable": live.healthReachable ? "yes" : "no",
    "http status": live.httpStatus !== null ? String(live.httpStatus) : "n/a",
    "registry ok": live.registryOk === null ? "unknown" : live.registryOk ? "yes" : "no",
    "terminal execution": "persistent sandbox CLI session available",
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) detail.notes = live.errors.join("; ");
  return detail;
}

async function fetchLiveStatus(): Promise<AgyLiveStatus | null> {
  if (typeof window === "undefined") return null;
  try {
    const response = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as AgyLiveStatus;
  } catch {
    return null;
  }
}

export const agyAdapter: AgentSystemAdapter = {
  ...base,

  async getState(): Promise<AgentSystemState> {
    const baseState = await base.getState();
    const live = await fetchLiveStatus();
    const runState: RunState = live?.status === "degraded" ? "error" : "idle";

    return {
      ...baseState,
      status: live?.status ?? "connected",
      runState,
      health: live?.status === "degraded" ? "warn" : "ok",
      currentTask: "Persistent Antigravity coding-assistant session available",
      connectorMode: "cli",
      commandExecution: true,
      outputKind: "live-status",
      statusDetail: live ? toStatusDetail(live) : {
        "agent runtime": "Antigravity CLI 1.0.12",
        "agent role": "Agentic AI coding assistant",
        workspace: "/opt/vireon/workfloor",
        "terminal execution": "persistent sandbox CLI session available",
      },
      controlledAction: {
        id: "antigravity-agent",
        label: "Send to Antigravity",
        endpoint: "/api/connectors/agy/actions/ask",
        requiresInput: true,
      },
      capabilities: [
        { kind: "status", available: true },
        { kind: "controlledPrompt", available: true, reason: "persistent Antigravity sandbox CLI session" },
        {
          kind: "projectContext",
          available: true,
          reason: "Antigravity project bound to /opt/vireon/workfloor",
        },
      ],
    };
  },
};
