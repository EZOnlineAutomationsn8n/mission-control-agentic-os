import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { databaseEnabled, databaseQuery } from "@/lib/persistence/database";

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
    if (databaseEnabled()) {
      const payload = JSON.stringify(e);
      await databaseQuery(
        `INSERT INTO audit_events (payload, event_at, event_hash)
         VALUES ($1::jsonb, $2::timestamptz, $3)
         ON CONFLICT (event_hash) WHERE event_hash IS NOT NULL DO NOTHING`,
        [payload, e.timestamp, createHash("sha256").update(payload).digest("hex")]
      );
      return { ok: true };
    }
    await fs.mkdir(auditDirectory(), { recursive: true });
    await fs.appendFile(auditFile(), `${JSON.stringify(e)}\n`, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "append failed" };
  }
}

export async function readAuditEvents(limit = MAX_READ): Promise<PersistedAuditEvent[]> {
  if (databaseEnabled()) {
    const result = await databaseQuery<{ payload: PersistedAuditEvent }>(
      "SELECT payload FROM audit_events ORDER BY sequence DESC LIMIT $1",
      [limit]
    );
    return result.rows.map((row) => row.payload);
  }
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
