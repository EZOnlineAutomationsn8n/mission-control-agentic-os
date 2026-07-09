import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { BrowserAgentsLiveStatus } from "../live/browser-agents-status-types";

// ─────────────────────────────────────────────────────────────────────────
// BROWSER AGENTS — eighth connector: live detection wired; command channel pending integration.
//
// `getState()` fetches read-only status from GET /api/connectors/
// browser-agents/status, backed by src/lib/connectors/live/
// browser-agents-status.ts (server-side: a local GET to the standard
// Chrome DevTools discovery endpoint `/json/version` — never a CDP
// WebSocket connection, never a CDP command, never page/tab content). If
// the live read fails, this falls back to the underlying mock transport,
// clearly labeled "mock stream" rather than "live status".
//
// No browser automation process was found running on this host during
// recon, so this reader honestly reports "disconnected" rather than
// fabricating a connected state — same posture as Hermes reporting
// "degraded" in the Core-4 pass.
//
// Hard constraint honored here: commandExecution is ALWAYS false for
// Browser Agents, in both the live and fallback branches. sendCommand/
// start/pause/resume/stop are no-ops — nothing ever drives a real browser
// tab from this UI.
//
// ─── REAL ADAPTER ATTACHMENT POINT (next step, not this pass) ──────────
// To wire real command execution: replace the no-op sendCommand/start/etc. below
// with a transport that talks to a real CDP session (Playwright / claude-
// in-chrome style bridge), gated by an explicit operator opt-in. Contract:
// implements AgentSystemAdapter.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "browser-agents",
  name: "Browser Agents",
  type: "browser-agent",
  category: "Browser Agents",
  connectionModes: ["browser"],
  activeMode: "browser",
  status: "pending-setup",
  capabilities: ["web navigation", "form filling", "scraping", "visual verification"],
  permissions: ["control-browser-tab", "read-page-content"],
  lastSync: null,
  memoryWriteObligation: true,
  obsidianWriteTarget: "Reports/browser-agents",
  realConnectionFields: [
    { key: "cdpEndpoint", label: "Chrome DevTools Protocol endpoint", placeholder: "ws://127.0.0.1:9222", kind: "url" },
    { key: "profilePath", label: "Browser profile path", placeholder: "/opt/profiles/agent-1", kind: "path" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "Browser automation bridge (not yet attached)",
  initialRunState: "idle",
  taskLines: ["awaiting connector attachment"],
  streamLines: ["placeholder connector — no live browser session"],
  seedLogs: [
    {
      level: "warn",
      agentId: "browser-agents",
      message: "connector registered but not attached — pending-setup",
      sourceRef: null,
    },
  ],
  seedReports: [],
  seedApprovals: [],
  readActions: ["read-page-content"],
  writeActions: ["control-browser-tab"],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/browser-agents/status";

function toStatusDetail(live: BrowserAgentsLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    "cdp reachable": live.cdpReachable ? "yes" : "no",
    "cdp version": live.cdpVersion ?? "unknown",
    "profile path configured": live.profilePathExists ? "yes" : "no",
    "command execution": "not commandable — no safe command endpoint wired",
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) {
    detail.notes = live.errors.join("; ");
  }
  return detail;
}

async function fetchLiveStatus(): Promise<BrowserAgentsLiveStatus | null> {
  if (typeof window === "undefined") return null; // never fetch during SSR
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as BrowserAgentsLiveStatus;
  } catch {
    return null;
  }
}

export const browserAgentsAdapter: AgentSystemAdapter = {
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

    const runState: RunState = live.status === "connected" ? "running" : "stopped";

    return {
      ...baseState,
      status: live.status,
      runState,
      health: live.status === "connected" ? "ok" : "fail",
      currentTask: `CDP ${live.cdpReachable ? "reachable" : "unreachable"} (${live.status}) — ${live.source}`,
      connectorMode: "browser",
      commandExecution: false,
      outputKind: "live-status",
      statusDetail: toStatusDetail(live),
      capabilities: [
        { kind: "status", available: true },
        {
          kind: "readOnlyData",
          available: live.cdpReachable,
          reason: live.cdpReachable
            ? "browser product/version metadata via CDP /json/version"
            : "no CDP endpoint reachable",
        },
      ],
    };
  },

  // Hard constraint: Browser Agents has no command channel wired yet. None
  // of these ever reach a real browser tab — inert no-ops regardless of
  // what the UI does, as a defense-in-depth backstop behind the
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
