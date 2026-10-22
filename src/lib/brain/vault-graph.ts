import { promises as fs } from "node:fs";
import path from "node:path";

// Read-only knowledge graph over the Obsidian vault projection that Mission Control already binds
// (see connectors/live/obsidian-status.ts). Nothing here writes to any vault.

export interface VaultGraphNode { id: string; title: string; folder: string; degree: number; bytes: number }
export interface VaultGraphLink { source: string; target: string }
export interface VaultGraph {
  root: string;
  bindingKind: "derived-readonly-projection" | "direct-readonly-vault";
  fingerprint: string | null;
  generatedAt: string | null;
  scannedAt: string;
  nodes: VaultGraphNode[];
  links: VaultGraphLink[];
  folders: string[];
  unresolvedLinks: number;
}

const CANDIDATE_ROOTS = [
  process.env.OBSIDIAN_VAULT_PATH,
  "/imports/vireon-vault-current",
  "/opt/vireon/workfloor/obsidian/vault",
].filter((value): value is string => Boolean(value));

const MAX_NOTES = 5000;
const MAX_NOTE_BYTES = 400_000;
const WIKILINK_RE = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MDLINK_RE = /\[[^\]]*\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/gi;

let cache: { at: number; graph: VaultGraph } | null = null;

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

export async function resolveVaultRoot(): Promise<string | null> {
  for (const candidate of CANDIDATE_ROOTS) {
    if (await exists(path.join(candidate, ".obsidian")) || await exists(path.join(candidate, "PROJECTION_MANIFEST.json"))) {
      return fs.realpath(candidate);
    }
  }
  return null;
}

async function listNotes(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    if (out.length >= MAX_NOTES) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= MAX_NOTES) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(path.relative(root, full));
    }
  }
  await walk(root);
  return out.sort();
}

export async function buildVaultGraph(force = false): Promise<VaultGraph | null> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.graph;
  const root = await resolveVaultRoot();
  if (!root) return null;
  let fingerprint: string | null = null;
  let generatedAt: string | null = null;
  let bindingKind: VaultGraph["bindingKind"] = "direct-readonly-vault";
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, "PROJECTION_MANIFEST.json"), "utf8")) as { fingerprint?: string; generated_at?: string };
    fingerprint = manifest.fingerprint ?? null;
    generatedAt = manifest.generated_at ?? null;
    bindingKind = "derived-readonly-projection";
  } catch { /* direct vault */ }

  const files = await listNotes(root);
  const ids = files.map((file) => file.slice(0, -3).split(path.sep).join("/"));
  const byPath = new Map(ids.map((id) => [id.toLowerCase(), id]));
  const byName = new Map<string, string>();
  for (const id of ids) {
    const name = id.split("/").pop()!.toLowerCase();
    if (!byName.has(name)) byName.set(name, id);
  }
  const resolve = (raw: string, fromId: string): string | null => {
    let target = decodeURIComponent(raw).trim().replace(/\\/g, "/").replace(/\.md$/i, "");
    if (!target) return null;
    if (target.startsWith("./") || target.startsWith("../")) {
      target = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), target));
    }
    const lower = target.toLowerCase().replace(/^\/+/, "");
    return byPath.get(lower) ?? byName.get(lower.split("/").pop()!) ?? null;
  };

  const nodes = new Map<string, VaultGraphNode>();
  const linkSet = new Set<string>();
  const links: VaultGraphLink[] = [];
  let unresolved = 0;
  for (let i = 0; i < files.length; i += 1) {
    const id = ids[i];
    const parts = id.split("/");
    let content = "";
    let bytes = 0;
    try {
      const stat = await fs.stat(path.join(root, files[i]));
      bytes = stat.size;
      if (stat.size <= MAX_NOTE_BYTES) content = await fs.readFile(path.join(root, files[i]), "utf8");
    } catch { /* unreadable note stays a node without links */ }
    nodes.set(id, { id, title: parts[parts.length - 1], folder: parts.length > 1 ? parts[0] : "(root)", degree: 0, bytes });
    const targets: string[] = [];
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(content))) targets.push(m[1]);
    MDLINK_RE.lastIndex = 0;
    while ((m = MDLINK_RE.exec(content))) if (!/^[a-z]+:\/\//i.test(m[1])) targets.push(m[1]);
    for (const raw of targets) {
      const target = resolve(raw, id);
      if (!target) { unresolved += 1; continue; }
      if (target === id) continue;
      const key = id < target ? `${id}\u0000${target}` : `${target}\u0000${id}`;
      if (linkSet.has(key)) continue;
      linkSet.add(key);
      links.push({ source: id, target });
    }
  }
  for (const link of links) {
    nodes.get(link.source)!.degree += 1;
    nodes.get(link.target)!.degree += 1;
  }
  const graph: VaultGraph = {
    root,
    bindingKind,
    fingerprint,
    generatedAt,
    scannedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    links,
    folders: [...new Set([...nodes.values()].map((node) => node.folder))].sort(),
    unresolvedLinks: unresolved,
  };
  cache = { at: Date.now(), graph };
  return graph;
}

export async function readVaultNote(id: string): Promise<{ id: string; content: string; truncated: boolean } | null> {
  const root = await resolveVaultRoot();
  if (!root || !id || id.includes("\u0000")) return null;
  const candidate = path.resolve(root, `${id}.md`);
  let real: string;
  try { real = await fs.realpath(candidate); } catch { return null; }
  if (!real.startsWith(root + path.sep)) return null;
  const buffer = await fs.readFile(real);
  const truncated = buffer.length > MAX_NOTE_BYTES;
  return { id, content: buffer.subarray(0, MAX_NOTE_BYTES).toString("utf8"), truncated };
}
