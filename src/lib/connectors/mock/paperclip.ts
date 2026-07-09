import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { PaperclipLiveStatus } from "../live/paperclip-status-types";

// ─────────────────────────────────────────────────────────────────────────
// PAPERCLIP — fifth real (partial) connector: live detection wired; command channel pending integration.
//
// `getState()` fetches read-only status from GET /api/connectors/paperclip/
// status, backed by src/lib/connectors/live/paperclip-status.ts (server-
// side: a local HTTP GET to Paperclip's own /api/health endpoint + a pure
// /proc/<pid>/cmdline scan — never a prompt/command to Paperclip, never a
// database/document read, never .env/secret reads). If the live read
// fails, this falls back to the underlying mock transport, clearly
// labeled "mock stream" rather than "live status".
//
// Hard constraint honored here: commandExecution is ALWAYS false for
// Paperclip, in both the live and fallback branches. sendCommand/start/
// pause/resume/stop are no-ops — nothing is ever dispatched to the real
// Paperclip process from this UI.
//
// ─── REAL ADAPTER ATTACHMENT POINT (next step, not this pass) ──────────
// To wire real command execution: replace the no-op sendCommand/start/etc. below
// with a transport that talks to Paperclip's own authenticated API surface,
// gated by an explicit operator opt-in and real credentials. Contract:
// implements AgentSystemAdapter.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "paperclip",
  name: "Paperclip",
  type: "agent",
  category: "AI Agents",
  connectionModes: ["api", "cli", "filesystem"],
  // "api" because live status is read via Paperclip's own local HTTP
  // /api/health endpoint, not a filesystem/process inspection.
  activeMode: "api",
  // Static fallback shown only before the first live check resolves;
  // overridden every poll by the live/fallback logic in getState() below.
  status: "degraded",
  capabilities: [
    "live bootstrap/health status (read-only)",
    "process liveness detection",
    "no direct command channel (integration pending)",
  ],
  permissions: ["read-health-endpoint", "read-proc-cmdline"],
  lastSync: "2026-07-08T06:30:00Z",
  memoryWriteObligation: true,
  obsidianWriteTarget: "Reports/paperclip",
  realConnectionFields: [
    { key: "apiUrl", label: "Paperclip API URL", placeholder: "https://paperclip.internal/api", kind: "url" },
    { key: "dbConnectionString", label: "Database connection string", placeholder: "postgres://•••••", kind: "secret" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "Paperclip runtime (workbench/toolchain)",
  initialRunState: "idle",
  taskLines: [
    "extracting contact fields from uploaded PDFs",
    "enriching lead records with sector tags",
    "syncing verified leads to project database",
  ],
  streamLines: [
    "extracted 12 contact records from batch upload",
    "enriched 12/12 records with sector tags",
    "synced to database — 0 conflicts",
  ],
  seedLogs: [
    { level: "info", agentId: "paperclip", message: "idle — no batches queued", sourceRef: null },
  ],
  seedReports: [
    {
      agentId: "paperclip",
      title: "Lead enrichment batch — 2026-07-06",
      kind: "report",
      savedToBrain: false,
      brainPath: null,
      excerpt: "Enriched 12 leads with sector + country tags, ready for Hermes verification.",
    },
  ],
  seedApprovals: [],
  readActions: ["read-health-endpoint", "read-proc-cmdline"],
  writeActions: ["write-db"],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/paperclip/status";

function toStatusDetail(live: PaperclipLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    "health reachable": live.healthReachable ? "yes" : "no",
    "http status": live.httpStatus !== null ? String(live.httpStatus) : "n/a",
    "bootstrap status": live.bootstrapStatus ?? "unknown",
    "deployment mode": live.deploymentMode ?? "unknown",
    "pid alive": live.pidAlive ? "yes" : "no",
    "command execution": "not commandable — no safe command endpoint wired",
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) {
    detail.notes = live.errors.join("; ");
  }
  return detail;
}

async function fetchLiveStatus(): Promise<PaperclipLiveStatus | null> {
  if (typeof window === "undefined") return null; // never fetch during SSR
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PaperclipLiveStatus;
  } catch {
    return null;
  }
}

export const paperclipAdapter: AgentSystemAdapter = {
  ...base,

  async getState(): Promise<AgentSystemState> {
    const baseState = await base.getState();
    const live = await fetchLiveStatus();

    if (!live) {
      // Live read unavailable — fall back to the mock transport as-is.
      // Never claim live status when we couldn't confirm it.
      return {
        ...baseState,
        commandExecution: false,
        outputKind: "mock-stream",
        statusDetail: null,
      };
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
      externalUrl: "http://127.0.0.1:3100",
      capabilities: [
        { kind: "status", available: true },
        { kind: "readOnlyData", available: true, reason: "bootstrap/deployment metadata via /api/health" },
      ],
    };
  },

  // Hard constraint: Paperclip has no command channel wired yet. None of
  // these ever reach the real process — inert no-ops regardless of what
  // the UI does, as a defense-in-depth backstop behind the
  // commandExecution=false UI gating.
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
