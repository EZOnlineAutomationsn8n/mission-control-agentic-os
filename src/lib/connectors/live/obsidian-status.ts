import { promises as fs } from "fs";
import path from "path";
import type { ObsidianLiveStatus } from "./obsidian-status-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Must only be imported from a server context (the API route
// below). Never import it from a "use client" component or from
// src/lib/connectors/mock/obsidian.ts.
//
// Read-only Obsidian vault / Graphlink status + graph metadata. Per
// the read-only detection contract:
//   - reads each note's bytes only to extract [[wikilink]] targets for the
//     link graph — note bodies are never returned or exposed in the UI,
//     only aggregate counts and note titles (filenames), which is graph
//     metadata, not content
//   - never reads .env values, auth files, or secret-bearing config
//   - never executes anything, never spawns a subprocess from this reader
//   - never calls the read-only workfloor MCP server's tools — its
//     presence is only detected via a pure /proc/<pid>/cmdline scan
// ─────────────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || "/opt/vireon/workfloor/obsidian/vault";
const VAULT_MARKER_PATH = path.join(VAULT_PATH, ".obsidian");
const PROJECTION_MANIFEST_PATH = path.join(VAULT_PATH, "PROJECTION_MANIFEST.json");
const REQUIRE_LOCAL_MCP_PROCESS = process.env.OBSIDIAN_REQUIRE_LOCAL_MCP_PROCESS !== "0";
const MAX_FILES_SCANNED = 5000;
const MCP_BRIDGE_CMDLINE_MARKERS = ["workfloor-readonly-mcp"];
const WIKILINK_RE = /\[\[([^\]|#]+)/g;
const TOP_LINKED_LIMIT = 5;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface GraphMetrics {
  noteCount: number;
  linkCount: number;
  orphanCount: number;
  topLinkedNotes: string[];
}

interface ProjectionManifest {
  source: string;
  fingerprint: string;
  generated_at: string;
  note_count: number;
  content_policy: string;
}

async function readProjectionManifest(): Promise<ProjectionManifest | null> {
  try {
    const raw = JSON.parse(await fs.readFile(PROJECTION_MANIFEST_PATH, "utf8")) as Partial<ProjectionManifest>;
    if (
      typeof raw.source !== "string" || typeof raw.fingerprint !== "string" ||
      typeof raw.generated_at !== "string" || typeof raw.note_count !== "number" ||
      typeof raw.content_policy !== "string"
    ) return null;
    return raw as ProjectionManifest;
  } catch {
    return null;
  }
}

/**
 * Walks the vault once, extracting only [[wikilink]] targets per note to
 * build an in-memory link graph. Never returns note bodies — only counts
 * and note titles (filenames), which is graph metadata.
 */
async function scanVaultGraph(rootDir: string): Promise<GraphMetrics | null> {
  const notes = new Map<string, { title: string; outLinks: Set<string> }>();
  let visited = 0;

  async function walk(dir: string): Promise<void> {
    if (visited >= MAX_FILES_SCANNED) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= MAX_FILES_SCANNED) return;
      visited += 1;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".obsidian") continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const title = entry.name.slice(0, -3);
        const key = title.toLowerCase();
        let content = "";
        try {
          content = await fs.readFile(full, "utf8");
        } catch {
          content = "";
        }
        const outLinks = new Set<string>();
        WIKILINK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = WIKILINK_RE.exec(content))) {
          const target = m[1].trim().toLowerCase();
          if (target) outLinks.add(target);
        }
        notes.set(key, { title, outLinks });
      }
    }
  }

  try {
    await walk(rootDir);
  } catch {
    return null;
  }

  const inDegree = new Map<string, number>();
  let linkCount = 0;
  for (const [, note] of notes) {
    for (const target of note.outLinks) {
      linkCount += 1;
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }
  }

  let orphanCount = 0;
  for (const [key, note] of notes) {
    const hasIn = (inDegree.get(key) ?? 0) > 0;
    if (!hasIn && note.outLinks.size === 0) orphanCount += 1;
  }

  const topLinkedNotes = Array.from(notes.entries())
    .map(([key, note]) => ({ title: note.title, inDegree: inDegree.get(key) ?? 0 }))
    .filter((n) => n.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, TOP_LINKED_LIMIT)
    .map((n) => `${n.title} (${n.inDegree})`);

  return { noteCount: notes.size, linkCount, orphanCount, topLinkedNotes };
}

/** Pure filesystem process-existence check via /proc/<pid>/cmdline (public argv only). */
async function findMcpBridgePid(): Promise<number | null> {
  let entries: string[];
  try {
    entries = await fs.readdir("/proc");
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const raw = await fs.readFile(`/proc/${entry}/cmdline`, "utf8");
      const joined = raw.split("\0").filter(Boolean).join(" ");
      if (MCP_BRIDGE_CMDLINE_MARKERS.every((marker) => joined.includes(marker))) {
        return Number(entry);
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function readObsidianLiveStatus(): Promise<ObsidianLiveStatus> {
  const errors: string[] = [];

  const vaultPathExists = await pathExists(VAULT_PATH);
  if (!vaultPathExists) {
    errors.push(`vault path not found: ${VAULT_PATH}`);
  }

  const vaultMarkerFound = vaultPathExists ? await pathExists(VAULT_MARKER_PATH) : false;
  if (vaultPathExists && !vaultMarkerFound) {
    errors.push("vault path exists but .obsidian marker directory is missing");
  }

  const projectionManifestFound = vaultPathExists ? await pathExists(PROJECTION_MANIFEST_PATH) : false;
  const projectionManifest = projectionManifestFound ? await readProjectionManifest() : null;
  if (projectionManifestFound && !projectionManifest) {
    errors.push("projection manifest exists but is invalid or unreadable");
  }

  const graph = vaultPathExists ? await scanVaultGraph(VAULT_PATH) : null;
  if (vaultPathExists && graph === null) {
    errors.push("vault path exists but graph metadata could not be read");
  }

  const mcpBridgePid = REQUIRE_LOCAL_MCP_PROCESS ? await findMcpBridgePid() : null;
  const mcpBridgeDetected = REQUIRE_LOCAL_MCP_PROCESS ? mcpBridgePid !== null : null;
  if (REQUIRE_LOCAL_MCP_PROCESS && !mcpBridgeDetected) {
    errors.push("read-only workfloor MCP bridge process not detected");
  }

  let status: ObsidianLiveStatus["status"];
  if (vaultPathExists && vaultMarkerFound && (mcpBridgeDetected || !REQUIRE_LOCAL_MCP_PROCESS)) {
    status = "connected";
  } else if (vaultPathExists) {
    status = "degraded";
  } else {
    status = "disconnected";
  }

  return {
    systemId: "obsidian",
    label: "Obsidian — Shared Brain / Graphlink",
    status,
    mode: REQUIRE_LOCAL_MCP_PROCESS ? "local-fs-status" : "mounted-readonly-status",
    source: VAULT_PATH,
    authoritySource: projectionManifest?.source ?? VAULT_PATH,
    bindingKind: projectionManifest ? "derived-readonly-projection" : "direct-readonly-vault",
    projectionManifestFound,
    projectionFingerprint: projectionManifest?.fingerprint ?? null,
    projectionGeneratedAt: projectionManifest?.generated_at ?? null,
    projectionNoteCount: projectionManifest?.note_count ?? null,
    projectionContentPolicy: projectionManifest?.content_policy ?? null,
    canonicalByDisplay: false,
    vaultPathExists,
    vaultMarkerFound,
    noteCount: graph?.noteCount ?? null,
    linkCount: graph?.linkCount ?? null,
    orphanCount: graph?.orphanCount ?? null,
    topLinkedNotes: graph?.topLinkedNotes ?? [],
    mcpBridgeDetected,
    commandExecution: false,
    outputKind: "live-status",
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
