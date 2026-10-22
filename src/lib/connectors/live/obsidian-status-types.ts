// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling server-only code into
// the browser bundle. The actual reader lives in obsidian-status.ts and is
// only ever invoked from the server-side API route.

export type ObsidianConnectorStatus = "connected" | "degraded" | "disconnected";

export interface ObsidianLiveStatus {
  systemId: "obsidian";
  label: "Obsidian — Shared Brain / Graphlink";
  status: ObsidianConnectorStatus;
  mode: "local-fs-status" | "mounted-readonly-status";
  /** Mission Control read surface (may be a derived immutable projection). */
  source: string;
  /** Durable source authority from which the read surface was derived. */
  authoritySource: string;
  bindingKind: "derived-readonly-projection" | "direct-readonly-vault";
  projectionManifestFound: boolean;
  projectionFingerprint: string | null;
  projectionGeneratedAt: string | null;
  projectionNoteCount: number | null;
  projectionContentPolicy: string | null;
  /** Display/index state never promotes itself to canonical authority. */
  canonicalByDisplay: false;
  vaultPathExists: boolean;
  vaultMarkerFound: boolean;
  /** Count only — never note content. */
  noteCount: number | null;
  /** Total [[wikilink]] edges across the vault — graph metadata, not content. */
  linkCount: number | null;
  /** Notes with zero inbound and zero outbound links. */
  orphanCount: number | null;
  /** Top linked note titles with their inbound link count, e.g. "Overview (7)". Titles only, no body content. */
  topLinkedNotes: string[];
  /** Read-only workfloor MCP bridge process detected via /proc scan (no MCP calls made). */
  mcpBridgeDetected: boolean | null;
  commandExecution: false;
  outputKind: "live-status";
  lastCheckedAt: string;
  errors: string[];
}
