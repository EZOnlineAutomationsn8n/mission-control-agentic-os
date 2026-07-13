import { promises as fs } from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Append-only local audit persistence, inside the project
// directory only (data/audit-log.jsonl) — no external DB, no secrets, no
// service touched. Only ever written to via the /api/audit route handler.
// This is a durability layer underneath the in-memory action-log-store:
// the in-memory store stays the source of truth for the live-session UI;
// this file is what makes an audit event survive a full page reload.
// ─────────────────────────────────────────────────────────────────────────

const MAX_READ = 500;

function auditDirectory(): string {
  return process.env.AUDIT_DATA_DIR || path.join(process.cwd(), "data");
}

function auditFile(): string {
  return path.join(auditDirectory(), "audit-log.jsonl");
}

export interface PersistedAuditEvent {
  timestamp: string;
  connectorId: string;
  actionType: string;
  status: string;
  resultSummary: string;
}

export async function appendAuditEvent(
  e: PersistedAuditEvent
): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.mkdir(auditDirectory(), { recursive: true });
    await fs.appendFile(auditFile(), `${JSON.stringify(e)}\n`, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "append failed" };
  }
}

export async function readAuditEvents(limit = MAX_READ): Promise<PersistedAuditEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(auditFile(), "utf8");
  } catch {
    return [];
  }
  const parsed: PersistedAuditEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line) as PersistedAuditEvent);
    } catch {
      // skip a malformed line rather than fail the whole read
    }
  }
  return parsed.slice(-limit).reverse();
}
