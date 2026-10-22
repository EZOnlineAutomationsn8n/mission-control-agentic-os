import type { AgentSystemState, ConnectorDescriptor, ObsidianAdapter, RunState } from "../types";
import { createMockAdapter } from "./shared";
import { vaultEngine } from "./obsidian-instance";
import type { ObsidianLiveStatus } from "../live/obsidian-status-types";

// ─────────────────────────────────────────────────────────────────────────
// OBSIDIAN — fourth real (partial) connector: live detection wired; command channel pending integration.
//
// `getState()` fetches read-only status from GET /api/connectors/obsidian/
// status, backed by src/lib/connectors/live/obsidian-status.ts (server-
// side: vault path + `.obsidian` marker existence, a note *count* — never
// content — and a /proc scan for the read-only workfloor MCP bridge
// process). If the live read fails, this falls back to the underlying mock
// transport, clearly labeled "mock stream" rather than "live status".
//
// The vault *content* methods below (listVaultNotes, readNote, etc.) are
// unchanged — they operate on Mission Control's own in-memory mock
// vaultEngine (used by the Shared Brain / Project Layer pages), not the
// real Obsidian vault on disk. Only the connector's status/run-state layer
// is now live; nothing about the mock Brain content model changed.
//
// Hard constraint honored here: commandExecution is ALWAYS false for
// Obsidian, in both the live and fallback branches. sendCommand/start/
// pause/resume/stop are no-ops — nothing is ever dispatched to the real
// vault or the MCP bridge from this UI.
//
// ─── REAL ADAPTER ATTACHMENT POINT (next step, not this pass) ──────────
// Replace MockTransport (createMockAdapter) + vaultEngine with one of:
//   - local filesystem adapter pointed at a real Obsidian vault path
//   - Obsidian Local REST API plugin adapter (https://<host>:27124)
//   - Obsidian MCP server adapter
//   - CLI/file-watcher fallback
// Contract: implements ObsidianAdapter. Nothing above this layer changes.
// ─────────────────────────────────────────────────────────────────────────

const descriptor: ConnectorDescriptor = {
  id: "obsidian",
  name: "Obsidian — Shared Brain",
  type: "memory",
  category: "Knowledge / Memory",
  connectionModes: ["filesystem", "api", "mcp"],
  activeMode: "filesystem",
  // Static fallback shown only before the first live check resolves;
  // overridden every poll by the live/fallback logic in getState() below.
  status: "degraded",
  capabilities: [
    "read-only current ViREON vault projection",
    "graph metadata",
    "derived Shared Brain source index",
    "no live vault mutation",
  ],
  permissions: ["read-projection", "read-graph-metadata", "no-live-vault-write"],
  lastSync: "2026-07-08T09:12:00Z",
  memoryWriteObligation: false,
  obsidianWriteTarget: null,
  realConnectionFields: [
    { key: "vaultPath", label: "Vault filesystem path", placeholder: "/Users/you/Vaults/Mission-Control", kind: "path" },
    { key: "restApiUrl", label: "Obsidian Local REST API URL", placeholder: "https://127.0.0.1:27124", kind: "url" },
    { key: "restApiKey", label: "Local REST API key", placeholder: "•••••••••••", kind: "secret" },
    { key: "mcpEndpoint", label: "Obsidian MCP endpoint", placeholder: "mcp://obsidian-vault", kind: "url" },
  ],
};

const base = createMockAdapter({
  descriptor,
  modelOrService: "Obsidian Vault (mock filesystem)",
  taskLines: [
    "indexing new notes",
    "resolving backlinks",
    "watching for vault changes",
    "compacting session index",
  ],
  streamLines: [
    "watcher: no changes detected",
    "indexed 1 note in Reports/",
    "backlink graph refreshed",
    "session index integrity check passed",
  ],
  initialRunState: "running",
  seedLogs: [
    { level: "info", agentId: "obsidian", message: "vault mounted (mock)", sourceRef: null },
  ],
  seedReports: [],
  seedApprovals: [],
  readActions: ["listVaultNotes", "readNote", "searchNotes", "followBacklinks"],
  writeActions: [
    "createNote",
    "appendToNote",
    "updateFrontmatter",
    "writeReportToGovernedFolder",
    "createSessionRegistryEntry",
    "createHandover",
  ],
});

const LIVE_STATUS_ENDPOINT = "/api/connectors/obsidian/status";

function toStatusDetail(live: ObsidianLiveStatus): Record<string, string> {
  const detail: Record<string, string> = {
    "authority source": live.authoritySource,
    "Mission Control read surface": live.source,
    binding: live.bindingKind,
    "canonical by display": live.canonicalByDisplay ? "yes" : "no",
    "projection fingerprint": live.projectionFingerprint ?? "direct source / none",
    "projection generated": live.projectionGeneratedAt ?? "direct source / none",
    "projection content policy": live.projectionContentPolicy ?? "direct source",
    "vault path exists": live.vaultPathExists ? "yes" : "no",
    "vault marker (.obsidian)": live.vaultMarkerFound ? "yes" : "no",
    "note count": live.noteCount !== null ? String(live.noteCount) : "unknown",
    "link count": live.linkCount !== null ? String(live.linkCount) : "unknown",
    "orphan count": live.orphanCount !== null ? String(live.orphanCount) : "unknown",
    "top linked notes": live.topLinkedNotes.length > 0 ? live.topLinkedNotes.join(", ") : "none",
    "mcp bridge detected": live.mcpBridgeDetected === null ? "not visible across container boundary" : live.mcpBridgeDetected ? "yes" : "no",
    "command execution": "not commandable — no safe command endpoint wired",
    source: live.source,
    "graph snapshot at": new Date(live.lastCheckedAt).toLocaleTimeString(),
  };
  if (live.errors.length > 0) {
    detail.notes = live.errors.join("; ");
  }
  return detail;
}

async function fetchLiveStatus(): Promise<ObsidianLiveStatus | null> {
  if (typeof window === "undefined") return null; // never fetch during SSR
  try {
    const res = await fetch(LIVE_STATUS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ObsidianLiveStatus;
  } catch {
    return null;
  }
}

export const obsidianAdapter: ObsidianAdapter = {
  ...base,
  listVaultNotes: vaultEngine.listVaultNotes,
  readNote: vaultEngine.readNote,
  searchNotes: vaultEngine.searchNotes,
  createNote: vaultEngine.createNote,
  appendToNote: vaultEngine.appendToNote,
  updateFrontmatter: vaultEngine.updateFrontmatter,
  followBacklinks: vaultEngine.followBacklinks,
  extractProjectNotes: vaultEngine.extractProjectNotes,
  extractSourceProofNotes: vaultEngine.extractSourceProofNotes,
  writeReportToGovernedFolder: vaultEngine.writeReportToGovernedFolder,
  createSessionRegistryEntry: vaultEngine.createSessionRegistryEntry,
  readPreviousSessions: vaultEngine.readPreviousSessions,
  writeDailyContinuityFile: vaultEngine.writeDailyContinuityFile,
  writeWeeklyContinuityFile: vaultEngine.writeWeeklyContinuityFile,
  createHandover: vaultEngine.createHandover,

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
      currentTask: `Vault ${live.vaultPathExists ? "present" : "missing"} (${live.status}) — ${live.bindingKind}`,
      modelOrService: live.bindingKind === "derived-readonly-projection"
        ? "ViREON durable vault → immutable read-only projection"
        : "ViREON durable vault (direct read-only)",
      connectorMode: "filesystem",
      commandExecution: false,
      outputKind: "live-status",
      statusDetail: toStatusDetail(live),
      capabilities: [
        { kind: "status", available: true },
        { kind: "graphRead", available: true, reason: "note/link/orphan counts — metadata only, no note content" },
      ],
    };
  },

  // Hard constraint: Obsidian's connector status/run-state is LIVE STATUS
  // ONLY in this pass. None of these ever reach the real vault or the MCP
  // bridge — inert no-ops regardless of what the UI does, as a defense-in-
  // depth backstop behind the commandExecution=false UI gating. (The vault
  // *content* write methods above are unchanged mock-Brain operations, not
  // real-world side effects.)
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
