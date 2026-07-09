import type {
  BrainWriteResult,
  HandoverRecord,
  ReportRef,
  SessionIndexEntry,
  VaultNote,
} from "../types";
import { seedVaultNotes } from "@/mocks/vault-notes";
import { seedSessionIndex } from "@/mocks/session-index";

// ─────────────────────────────────────────────────────────────────────────
// VAULT ENGINE — the actual mock persistence behind the Obsidian connector.
// This is the "filesystem" the whole Agentic OS writes human-readable
// memory into. It is intentionally separate from the generic adapter
// factory (shared.ts) because every other adapter's write actions route
// through this engine (universal memory-write obligation, §4).
//
// ─── REAL ADAPTER ATTACHMENT POINT ─────────────────────────────
// Replace this in-memory store with one of:
//   - filesystem adapter reading/writing an actual Obsidian vault directory
//   - Obsidian Local REST API plugin (https://) adapter
//   - Obsidian MCP server adapter
//   - CLI/file-watcher fallback that tails vault changes
// Contract: implements ObsidianAdapter's vault methods below. Nothing above
// this layer (UI, other connectors) changes.
// ─────────────────────────────────────────────────────────────────────────

const notes = new Map<string, VaultNote>(seedVaultNotes.map((n) => [n.path, n]));
let sessionCounter = seedSessionIndex.length;
const sessionEntries: SessionIndexEntry[] = [...seedSessionIndex];
const handovers: HandoverRecord[] = [];

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}
function nowISO() {
  return new Date().toISOString();
}

function computeBacklinks(path: string): string[] {
  const links: string[] = [];
  for (const n of notes.values()) {
    if (n.path === path) continue;
    if (n.body.includes(path) || n.body.includes(n.title)) {
      if (n.body.includes(path)) links.push(n.path);
    }
  }
  return links;
}

export const vaultEngine = {
  async listVaultNotes(): Promise<VaultNote[]> {
    return Array.from(notes.values()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async readNote(path: string): Promise<VaultNote | null> {
    const n = notes.get(path);
    if (!n) return null;
    return { ...n, backlinks: computeBacklinks(path) };
  },

  async searchNotes(query: string): Promise<VaultNote[]> {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return Array.from(notes.values()).filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)) ||
        n.folder.toLowerCase().includes(q)
    );
  },

  async createNote(note: Omit<VaultNote, "backlinks">): Promise<BrainWriteResult> {
    if (notes.has(note.path)) {
      return {
        ok: false,
        path: note.path,
        createdAt: nowISO(),
        note: "note already exists — overwrite requires approval",
        requiresApproval: true,
      };
    }
    notes.set(note.path, { ...note, backlinks: [] });
    return { ok: true, path: note.path, createdAt: nowISO(), note: "note created" };
  },

  async appendToNote(path: string, content: string): Promise<BrainWriteResult> {
    const existing = notes.get(path);
    if (!existing) {
      notes.set(path, {
        path,
        title: path.split("/").pop() ?? path,
        folder: path.split("/").slice(0, -1).join("/") || "/",
        updatedAt: nowISO(),
        tags: ["auto-created"],
        frontmatter: {},
        body: content,
        backlinks: [],
        kind: "note",
      });
      return { ok: true, path, createdAt: nowISO(), note: "note created and appended" };
    }
    existing.body = `${existing.body}\n${content}`;
    existing.updatedAt = nowISO();
    return { ok: true, path, createdAt: nowISO(), note: "appended" };
  },

  async updateFrontmatter(
    path: string,
    frontmatter: Record<string, string>
  ): Promise<BrainWriteResult> {
    const existing = notes.get(path);
    if (!existing) {
      return { ok: false, path, createdAt: nowISO(), note: "note not found" };
    }
    existing.frontmatter = { ...existing.frontmatter, ...frontmatter };
    existing.updatedAt = nowISO();
    return { ok: true, path, createdAt: nowISO(), note: "frontmatter updated" };
  },

  async followBacklinks(path: string): Promise<VaultNote[]> {
    const linkPaths = computeBacklinks(path);
    return linkPaths.map((p) => notes.get(p)).filter((n): n is VaultNote => !!n);
  },

  async extractProjectNotes(): Promise<VaultNote[]> {
    return Array.from(notes.values()).filter((n) => n.kind === "project");
  },

  async extractSourceProofNotes(): Promise<VaultNote[]> {
    return Array.from(notes.values()).filter((n) => n.kind === "proof");
  },

  async writeReportToGovernedFolder(report: ReportRef): Promise<BrainWriteResult> {
    const path = `Reports/${report.agentId}/${report.id}.md`;
    const body = [
      `# ${report.title}`,
      "",
      `- Agent: ${report.agentId}`,
      `- Kind: ${report.kind}`,
      `- Created: ${report.createdAt}`,
      "",
      report.excerpt,
    ].join("\n");
    notes.set(path, {
      path,
      title: report.title,
      folder: `Reports/${report.agentId}`,
      updatedAt: nowISO(),
      tags: [report.kind, report.agentId],
      frontmatter: { agent: report.agentId, kind: report.kind },
      body,
      backlinks: [],
      kind: report.kind === "proof" ? "proof" : "note",
    });
    return { ok: true, path, createdAt: nowISO(), note: "report written to governed folder" };
  },

  async createSessionRegistryEntry(
    entry: Omit<SessionIndexEntry, "sessionNumber">
  ): Promise<BrainWriteResult> {
    sessionCounter += 1;
    const sessionNumber = `SESSION-${String(sessionCounter).padStart(4, "0")}`;
    sessionEntries.unshift({ ...entry, sessionNumber });
    const block = renderSessionBlock({ ...entry, sessionNumber });
    await vaultEngine.appendToNote("AGENT_SESSION_INDEX.md", `\n${block}`);
    return {
      ok: true,
      path: "AGENT_SESSION_INDEX.md",
      createdAt: nowISO(),
      note: `appended ${sessionNumber} (append-only)`,
    };
  },

  async readPreviousSessions(query: {
    byAgent?: string;
    byTopic?: string;
    bySessionNumber?: string;
  }): Promise<SessionIndexEntry[]> {
    return sessionEntries.filter((e) => {
      if (query.byAgent && !e.agent.toLowerCase().includes(query.byAgent.toLowerCase())) return false;
      if (query.byTopic && !e.topic.toLowerCase().includes(query.byTopic.toLowerCase())) return false;
      if (query.bySessionNumber && e.sessionNumber !== query.bySessionNumber) return false;
      return true;
    });
  },

  async writeDailyContinuityFile(content: string): Promise<BrainWriteResult> {
    const path = `Continuity/daily/${new Date().toISOString().slice(0, 10)}.md`;
    notes.set(path, {
      path,
      title: `Daily continuity — ${new Date().toISOString().slice(0, 10)}`,
      folder: "Continuity/daily",
      updatedAt: nowISO(),
      tags: ["continuity", "daily"],
      frontmatter: {},
      body: content,
      backlinks: [],
      kind: "note",
    });
    return { ok: true, path, createdAt: nowISO(), note: "daily continuity file written" };
  },

  async writeWeeklyContinuityFile(content: string): Promise<BrainWriteResult> {
    const path = `Continuity/weekly/${new Date().toISOString().slice(0, 10)}.md`;
    notes.set(path, {
      path,
      title: `Weekly continuity — ${new Date().toISOString().slice(0, 10)}`,
      folder: "Continuity/weekly",
      updatedAt: nowISO(),
      tags: ["continuity", "weekly"],
      frontmatter: {},
      body: content,
      backlinks: [],
      kind: "note",
    });
    return { ok: true, path, createdAt: nowISO(), note: "weekly continuity file written" };
  },

  async createHandover(
    record: Omit<HandoverRecord, "id" | "createdAt" | "obsidianPath">
  ): Promise<BrainWriteResult> {
    const id = nextId("handover");
    const path = `Handovers/${id}.md`;
    const full: HandoverRecord = { ...record, id, createdAt: nowISO(), obsidianPath: path };
    handovers.unshift(full);
    notes.set(path, {
      path,
      title: `Handover: ${record.fromAgentId} → ${record.toAgentId ?? "unassigned"}`,
      folder: "Handovers",
      updatedAt: nowISO(),
      tags: ["handover"],
      frontmatter: { from: record.fromAgentId, to: record.toAgentId ?? "" },
      body: `## Reason\n${record.reason}\n\n## Context\n${record.contextSummary}`,
      backlinks: [],
      kind: "handover",
    });
    return { ok: true, path, createdAt: nowISO(), note: "handover created" };
  },

  listHandovers(): HandoverRecord[] {
    return handovers;
  },

  listSessionEntries(): SessionIndexEntry[] {
    return sessionEntries;
  },
};

function renderSessionBlock(e: SessionIndexEntry): string {
  return [
    `## ${e.sessionNumber}`,
    `- Date: ${e.date}`,
    `- Agent: ${e.agent}`,
    `- System: ${e.system}`,
    `- Topic: ${e.topic}`,
    `- Session ID: ${e.sessionId ?? "—"}`,
    `- Title: ${e.title}`,
    `- Summary: ${e.summary}`,
    `- Related files: ${e.relatedFiles.join(", ") || "—"}`,
    `- Obsidian links: ${e.obsidianLinks.join(", ") || "—"}`,
    `- Status: ${e.status}`,
    `- Next action: ${e.nextAction}`,
    `- Handover: ${e.handover ?? "—"}`,
    "",
  ].join("\n");
}

export function buildCopyPasteSessionBlock(
  entry: Omit<SessionIndexEntry, "sessionNumber">
): string {
  return renderSessionBlock({ ...entry, sessionNumber: "SESSION-XXXX (assign next number)" });
}
