import type { AgentSystemAdapter, AgentSystemState, ConnectorDescriptor, RunState } from "../types";
import { createMockAdapter } from "./shared";
import type { HermesLiveStatus } from "../live/hermes-status-types";

// ─────────────────────────────────────────────────────────────────────────
// HERMES — first real (partial) connector: live detection wired; command channel pending integration.
//
// This is no longer a pure mock. `getState()` fetches read-only status from
// GET /api/connectors/hermes/status, which is backed by
// src/lib/connectors/live/hermes-status.ts (server-side, filesystem +
// /proc only — never reads .env/auth.json, never executes the hermes
// binary, never attaches to tmux). If the live read fails for any reason,
// this falls back to the underlying mock transport so the panel still
// renders something reasonable, clearly labeled as "mock stream" rather
// than "live status".
//
// Hard constraint honored here: commandExecution is ALWAYS false for
// Hermes, in both the live and fallback branches. sendCommand/start/pause/
// resume/stop are no-ops — nothing is ever dispatched to the real gateway
// process from this UI.
//
// ─── REAL ADAPTER ATTACHMENT POINT (next step, not this pass) ──────────
// To wire real command execution: replace the no-op sendCommand/start/etc. below
// with a transport that talks to the Hermes gateway (its own IPC/API),
// gated by an explicit operator opt-in and real authentication — do not
// wire that up silently. Contract: implements AgentSystemAdapter.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "hermes",
  name: "Hermes",
  type: "agent",
  category: "AI Agents",
  connectionModes: ["cli", "api", "webhook", "filesystem"],
  // "filesystem" because live status is currently read by inspecting local
  // gateway state files + /proc, not by calling a Hermes API.
  activeMode: "filesystem",
  // Static fallback shown only before the first live check resolves;
  // overridden every poll by the live/fallback logic in getState() below,
  // and consumed by Sidebar/RegistryTable which prefer live state.status.
  status: "degraded",
  capabilities: [
    "live gateway status (read-only)",
    "process liveness detection",
    "no direct command channel (integration pending)",
  ],
  permissions: ["read-gateway-state", "read-proc", "write-vault-proofs"],
  lastSync: "2026-07-08T08:44:00Z",
  memoryWriteObligation: true,
  obsidianWriteTarget: "Governance/source-proofs",
  realConnectionFields: [
    { key: "apiUrl", label: "Hermes API URL", placeholder: "https://hermes.internal/api", kind: "url" },
    { key: "apiKey", label: "API key", placeholder: "hm_•••••", kind: "secret" },
    { key: "gatewayCliPath", label: "Gateway CLI path", placeholder: "/opt/hermes/bin/hermes", kind: "path" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "Hermes Agent v0.18.0 (OpenRouter · nemotron-3-ultra-550b)",
  initialRunState: "running",
  taskLines: [
    "cross-checking Maritime & Logistics registry filings",
    "matching company records against source registries",
    "flagging low-confidence matches for review",
    "writing source proof note",
  ],
  streamLines: [
    "fetched registry filing for record #4471",
    "match confidence 0.94 — accepted",
    "match confidence 0.51 — flagged for manual review",
    "wrote proof note to Governance/source-proofs",
  ],
  seedLogs: [
    { level: "info", agentId: "hermes", message: "verification batch started (42 records)", sourceRef: null },
  ],
  seedReports: [
    {
      agentId: "hermes",
      title: "Verification pass — Maritime & Logistics",
      kind: "proof",
      savedToBrain: true,
      brainPath: "Governance/source-proofs/2026-07-07-hermes-verification.md",
      excerpt: "39/42 records verified against registry filings. 3 flagged for manual review.",
    },
  ],
  seedApprovals: [
    {
      agentId: "hermes",
      requestedCapability: "write-vault-proofs: overwrite existing proof note",
      context: "New verification run conflicts with an existing proof note for the same batch.",
      riskLevel: "high",
      status: "pending",
    },
  ],
  readActions: ["read-gateway-state.json", "read-gateway.pid", "read-proc-status", "read-scaffold-contract"],
  writeActions: ["write-vault-proofs"],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/hermes/status";

/** Explains exactly why Hermes reads as degraded, in one line. */
function blockerReason(live: HermesLiveStatus): string | null {
  if (live.status === "connected") return null;
  const reasons: string[] = [];
  if (live.contractStatus === "SCAFFOLD_ONLY") reasons.push("integration contract is scaffold-only");
  if (live.platforms.length === 0) reasons.push("no messaging platform bridged");
  reasons.push("no operator command route wired");
  return reasons.join("; ");
}

function toStatusDetail(live: HermesLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    "gateway state": live.gatewayState,
    pid: live.pid !== null ? String(live.pid) : "unknown",
    "pid alive": live.pidAlive ? "yes" : "no",
    "platforms bridged": live.platforms.length > 0 ? live.platforms.join(", ") : "none",
    provider: live.provider,
    "default model": live.defaultModel,
    version: live.version,
    "contract status": live.contractStatus,
    "command execution": "not commandable — no safe command endpoint wired",
    source: live.source,
    "last checked": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  const blocker = blockerReason(live);
  if (blocker) {
    detail["blocked because"] = blocker;
    detail["next wiring required"] = "platform bridge + command route (contract must leave SCAFFOLD_ONLY)";
  }
  if (live.errors.length > 0) {
    detail.notes = live.errors.join("; ");
  }
  return detail;
}

async function fetchLiveStatus(): Promise<HermesLiveStatus | null> {
  if (typeof window === "undefined") return null; // never fetch during SSR
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as HermesLiveStatus;
  } catch {
    return null;
  }
}

export const hermesAdapter: AgentSystemAdapter = {
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
      currentTask: `Gateway ${live.gatewayState} (${live.status}) — ${live.source}`,
      connectorMode: "filesystem",
      commandExecution: false,
      outputKind: "live-status",
      statusDetail: toStatusDetail(live),
      capabilities: [
        { kind: "status", available: true },
        {
          kind: "blocked",
          available: true,
          reason: blockerReason(live) ?? "gateway connected but no command route wired",
        },
      ],
    };
  },

  // Hard constraint: Hermes has no command channel wired yet. None of these
  // ever reach the real gateway process — they are inert no-ops regardless
  // of what the UI does, as a defense-in-depth backstop behind the
  // commandExecution=false UI gating above.
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
