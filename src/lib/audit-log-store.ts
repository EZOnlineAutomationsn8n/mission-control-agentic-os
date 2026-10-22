import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { databaseEnabled, databaseQuery } from "@/lib/persistence/database";
import type { ConversationInitiator } from "@/lib/agent-conversations/initiator";

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
  // Provenance fields (REMEDIATION: Mission Control audit accountability, optional/back-compat).
  // actor: who initiated the event. This is a single-operator cockpit (Dennis is sole
  // authority per project policy), so "operator" is the honest current value, not a
  // per-request identity system. source: the exact call site that emitted the event.
  // correlationId: links a pre-execution intent event to its post-execution result event
  // (used by the mastermind dispatch idempotency remediation); absent on ordinary events.
  actor?: string;
  source?: string;
  correlationId?: string;
  initiator?: ConversationInitiator;
  initiatorVerified?: false;
}

export async function appendAuditEvent(
  e: PersistedAuditEvent
): Promise<{ ok: boolean; error?: string; inserted?: boolean }> {
  // REMEDIATION (Block C): `inserted` reports whether this call wrote a NEW row
  // versus being a no-op because a row with the same event_hash already existed
  // (migration 002's unique index). This is what the mastermind dispatch
  // idempotency check relies on: a "seen before" intent event returns
  // inserted:false without any UPDATE/DELETE, preserving append-only history.
  try {
    if (databaseEnabled()) {
      const payload = JSON.stringify(e);
      const result = await databaseQuery(
        `INSERT INTO audit_events (payload, event_at, event_hash)
         VALUES ($1::jsonb, $2::timestamptz, $3)
         ON CONFLICT (event_hash) WHERE event_hash IS NOT NULL DO NOTHING
         RETURNING sequence`,
        [payload, e.timestamp, createHash("sha256").update(payload).digest("hex")]
      );
      return { ok: true, inserted: (result.rowCount ?? 0) > 0 };
    }
    await fs.mkdir(auditDirectory(), { recursive: true });
    await fs.appendFile(auditFile(), `${JSON.stringify(e)}\n`, "utf8");
    // File-mode fallback has no dedup index; every append is treated as new.
    return { ok: true, inserted: true };
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
