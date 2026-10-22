import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_KEY_FILE = "/workspace/runtime-data/secrets/omi-dev-key";
const DEFAULT_OUTBOX_DIR = "/workspace/projects/agentic-os-brain/_system/outbox/omi";
const DEFAULT_STATE_DIR = "/workspace/runtime-data/omi-outbound-state";
const DEFAULT_API_URL = "https://api.omi.me/v1/dev/user/memories";
const AUTHORITY = "DENNIS_WO_SBC_05_20261003";
const ALLOWED_SLOTS = new Set(["DENNIS_INTENT", "CURRENT_PRIORITY", "PREFERENCE_AFFECTING_WORK", "CURRENT_DIRECTION"]);

interface OutboxCandidate {
  status: string;
  send_enabled?: boolean;
  origin: string;
  project: string;
  item_id: string;
  slot: string;
  text: string;
  source_record?: string | null;
  prepared_at?: string;
}

interface SendReceipt {
  receiptVersion: 1;
  candidateKey: string;
  itemId: string;
  project: string;
  slot: string;
  sourcePath: string;
  sourceSha256: string;
  requestedAt: string;
  completedAt: string;
  httpStatus: number | null;
  memoryId: string | null;
  readback: "PASS" | "NOT_FOUND" | "SKIPPED";
  result: "SENT" | "DELIVERY_UNCERTAIN" | "FAILED";
  authority: typeof AUTHORITY;
}

function keyFile() { return process.env.OMI_DEV_KEY_FILE || DEFAULT_KEY_FILE; }
function outboxDir() { return process.env.OMI_OUTBOX_DIR || DEFAULT_OUTBOX_DIR; }
function stateDir() { return process.env.OMI_OUTBOUND_STATE_DIR || DEFAULT_STATE_DIR; }
function apiUrl() { return process.env.OMI_DEV_MEMORY_URL || DEFAULT_API_URL; }

async function readDeveloperKey(): Promise<string> {
  const key = (process.env.OMI_DEV_KEY || await fs.readFile(keyFile(), "utf8")).trim();
  if (!key.startsWith("omi_dev_")) throw new Error("OMI Developer API key missing or invalid");
  return key;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function errorCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e ? String((e as NodeJS.ErrnoException).code) : undefined;
}

function validateCandidate(v: unknown): OutboxCandidate {
  if (!isRecord(v)) throw new Error("outbox candidate is not an object");
  for (const key of ["origin", "project", "item_id", "slot", "text"]) {
    if (typeof v[key] !== "string" || !(v[key] as string).trim()) throw new Error(`candidate missing ${key}`);
  }
  if (v.origin !== "shared-brain") throw new Error("candidate origin is not shared-brain");
  if (!ALLOWED_SLOTS.has(String(v.slot))) throw new Error(`candidate slot not authorized: ${String(v.slot)}`);
  if (!String(v.text).includes("[shared-brain-export]")) throw new Error("candidate missing Shared Brain loop tag");
  return v as unknown as OutboxCandidate;
}

function sourceHash(raw: string) { return createHash("sha256").update(raw).digest("hex"); }
function candidateKey(c: OutboxCandidate, hash: string) {
  return createHash("sha256").update(`${c.project}|${c.item_id}|${hash}`).digest("hex").slice(0, 24);
}
function wireMarker(key: string) { return `[shared-brain-export:${key}]`; }
function wireText(c: OutboxCandidate, key: string) {
  const marker = wireMarker(key);
  const budget = 500 - marker.length - 1;
  return `${marker} ${c.text.slice(0, Math.max(0, budget))}`;
}

async function listCandidates(): Promise<Array<{sourcePath:string; candidate:OutboxCandidate; hash:string; key:string}>> {
  let names: string[] = [];
  try { names = await fs.readdir(outboxDir()); } catch (e: unknown) { if (errorCode(e) === "ENOENT") return []; throw e; }
  const out: Array<{sourcePath:string; candidate:OutboxCandidate; hash:string; key:string}> = [];
  for (const name of names.filter(n => n.startsWith("PENDING_") && n.endsWith(".json")).sort()) {
    const sourcePath = path.join(outboxDir(), name);
    const raw = await fs.readFile(sourcePath, "utf8");
    const candidate = validateCandidate(JSON.parse(raw));
    const hash = sourceHash(raw);
    out.push({ sourcePath, candidate, hash, key: candidateKey(candidate, hash) });
  }
  return out;
}

function receiptPath(prefix: string, key: string) { return path.join(stateDir(), `${prefix}_${key}.json`); }
async function readReceipt(key: string): Promise<SendReceipt | null> {
  for (const prefix of ["SENT", "DELIVERY_UNCERTAIN"]) {
    try { return JSON.parse(await fs.readFile(receiptPath(prefix, key), "utf8")) as SendReceipt; } catch (e: unknown) { if (errorCode(e) !== "ENOENT") throw e; }
  }
  return null;
}
async function writeReceipt(key: string, receipt: SendReceipt) {
  await fs.mkdir(stateDir(), { recursive: true });
  const target = receiptPath(receipt.result, key);
  const temp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temp, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temp, target);
  return target;
}
async function promoteUncertainReceipt(key: string, old: SendReceipt, memoryId: string | null) {
  const next: SendReceipt = { ...old, completedAt: new Date().toISOString(), memoryId: memoryId || old.memoryId, readback: "PASS", result: "SENT" };
  const target = await writeReceipt(key, next);
  await fs.unlink(receiptPath("DELIVERY_UNCERTAIN", key)).catch(() => undefined);
  return target;
}

async function getMemories(key: string, limit = 1000) {
  const url = new URL(apiUrl());
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", "0");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  if (!response.ok) return { status: response.status, records: [] as Record<string, unknown>[] };
  const body = await response.json() as unknown;
  const records = Array.isArray(body) ? body.filter(isRecord) : isRecord(body) && Array.isArray(body.memories) ? body.memories.filter(isRecord) : [];
  return { status: response.status, records };
}
function findByMarker(records: Record<string, unknown>[], marker: string) {
  return records.find(r => String(r.content || "").includes(marker)) || null;
}

async function postMemory(key: string, text: string) {
  const response = await fetch(apiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, category: "system" }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const memoryId = typeof body.id === "string" ? body.id : typeof body.memory_id === "string" ? body.memory_id : null;
  return { status: response.status, ok: response.ok, memoryId };
}

export async function runOmiOutboundOnce() {
  if (process.env.OMI_OUTBOUND_AUTHORITY !== AUTHORITY) throw new Error("OMI outbound authority marker missing");
  const started = new Date().toISOString();
  const candidates = await listCandidates();
  const report = { startedAt: started, candidates: candidates.length, alreadySent: 0, reconciled: 0, sent: 0, uncertain: 0, failed: 0, receipts: [] as string[] };
  if (!candidates.length) return report;
  const key = await readDeveloperKey();
  for (const entry of candidates) {
    const marker = wireMarker(entry.key);
    const text = wireText(entry.candidate, entry.key);
    const prior = await readReceipt(entry.key);
    if (prior?.result === "SENT") { report.alreadySent += 1; continue; }

    const remoteBefore = await getMemories(key);
    const existing = findByMarker(remoteBefore.records, marker);
    if (existing) {
      const memoryId = typeof existing.id === "string" ? existing.id : null;
      if (prior?.result === "DELIVERY_UNCERTAIN") {
        report.receipts.push(await promoteUncertainReceipt(entry.key, prior, memoryId));
      } else {
        const receipt: SendReceipt = {
          receiptVersion: 1, candidateKey: entry.key, itemId: entry.candidate.item_id, project: entry.candidate.project,
          slot: entry.candidate.slot, sourcePath: entry.sourcePath, sourceSha256: entry.hash, requestedAt: started,
          completedAt: new Date().toISOString(), httpStatus: remoteBefore.status, memoryId, readback: "PASS", result: "SENT", authority: AUTHORITY,
        };
        report.receipts.push(await writeReceipt(entry.key, receipt));
      }
      report.reconciled += 1;
      continue;
    }

    // A successful POST without readback is delivery-uncertain. Never POST it again automatically;
    // later cycles reconcile by marker first, preventing duplicate creation after a crash/index delay.
    if (prior?.result === "DELIVERY_UNCERTAIN") { report.uncertain += 1; continue; }

    const post = await postMemory(key, text);
    if (!post.ok) {
      const receipt: SendReceipt = {
        receiptVersion: 1, candidateKey: entry.key, itemId: entry.candidate.item_id, project: entry.candidate.project,
        slot: entry.candidate.slot, sourcePath: entry.sourcePath, sourceSha256: entry.hash, requestedAt: started,
        completedAt: new Date().toISOString(), httpStatus: post.status, memoryId: post.memoryId, readback: "SKIPPED", result: "FAILED", authority: AUTHORITY,
      };
      report.receipts.push(await writeReceipt(entry.key, receipt));
      report.failed += 1;
      continue;
    }

    const remoteAfter = await getMemories(key);
    const confirmed = findByMarker(remoteAfter.records, marker);
    const result: SendReceipt["result"] = confirmed ? "SENT" : "DELIVERY_UNCERTAIN";
    const receipt: SendReceipt = {
      receiptVersion: 1, candidateKey: entry.key, itemId: entry.candidate.item_id, project: entry.candidate.project,
      slot: entry.candidate.slot, sourcePath: entry.sourcePath, sourceSha256: entry.hash, requestedAt: started,
      completedAt: new Date().toISOString(), httpStatus: post.status,
      memoryId: (confirmed && typeof confirmed.id === "string" ? confirmed.id : post.memoryId),
      readback: confirmed ? "PASS" : "NOT_FOUND", result, authority: AUTHORITY,
    };
    report.receipts.push(await writeReceipt(entry.key, receipt));
    if (confirmed) report.sent += 1; else report.uncertain += 1;
  }
  return report;
}

export const omiOutboundTestSupport = { validateCandidate, sourceHash, candidateKey, wireMarker, wireText, findByMarker, AUTHORITY };
