import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentConversationEntry } from "../src/lib/agent-conversations/types";
import type { AttachmentReference } from "../src/lib/attachments/types";
import type { PersistedAuditEvent } from "../src/lib/audit-log-store";
import { databasePool, databaseQuery } from "../src/lib/persistence/database";

const names = new Set([
  "agent-conversations.jsonl",
  "audit-log.jsonl",
  "attachments.jsonl",
  "claude-code-sessions.json",
  "cli-agent-sessions.json",
]);

async function discover(root: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const found: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isFile() && names.has(entry.name)) found.push(target);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".next") {
      found.push(...await discover(target, depth + 1));
    }
  }
  return found;
}

function jsonLines<T>(raw: string): T[] {
  return raw.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as T]; } catch { return []; }
  });
}

const roots = (process.env.LEGACY_STATE_ROOTS || "/workspace/runtime/staging:/workspace/projects/mission-control/data")
  .split(path.delimiter)
  .filter(Boolean);
const files = [...new Set((await Promise.all(roots.map((root) => discover(root)))).flat())].sort();
const counts = { sessions: 0, conversations: 0, audit: 0, attachments: 0, missingAttachments: 0 };

for (const file of files) {
  const raw = await fs.readFile(file, "utf8");
  const name = path.basename(file);

  if (name === "cli-agent-sessions.json" || name === "claude-code-sessions.json") {
    let records: Record<string, Record<string, unknown>> = {};
    try { records = JSON.parse(raw) as Record<string, Record<string, unknown>>; } catch { continue; }
    for (const payload of Object.values(records)) {
      const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
      const agentId = name === "claude-code-sessions.json"
        ? "claude-code"
        : typeof payload.agentId === "string" ? payload.agentId : null;
      if (!sessionKey || !agentId) continue;
      const sessionKind = name === "claude-code-sessions.json" ? "claude-code" : "cli";
      const result = await databaseQuery(
        `INSERT INTO agent_sessions (session_kind, agent_id, session_key, payload, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())
         ON CONFLICT (session_kind, agent_id, session_key)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         WHERE COALESCE(agent_sessions.payload->>'updatedAt', '') < COALESCE(EXCLUDED.payload->>'updatedAt', '')`,
        [sessionKind, agentId, sessionKey, JSON.stringify(payload)]
      );
      counts.sessions += result.rowCount ?? 0;
    }
    continue;
  }

  if (name === "agent-conversations.jsonl") {
    for (const entry of jsonLines<AgentConversationEntry>(raw)) {
      if (!entry.id || !entry.agentId || !entry.sessionId || !entry.createdAt) continue;
      const result = await databaseQuery(
        `INSERT INTO conversation_entries (id, agent_id, session_id, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [entry.id, entry.agentId, entry.sessionId, JSON.stringify(entry), entry.createdAt]
      );
      counts.conversations += result.rowCount ?? 0;
    }
    continue;
  }

  if (name === "audit-log.jsonl") {
    for (const event of jsonLines<PersistedAuditEvent>(raw)) {
      if (!event.timestamp || !event.connectorId || !event.actionType) continue;
      const payload = JSON.stringify(event);
      const result = await databaseQuery(
        `INSERT INTO audit_events (payload, event_at, event_hash)
         VALUES ($1::jsonb, $2::timestamptz, $3)
         ON CONFLICT (event_hash) WHERE event_hash IS NOT NULL DO NOTHING`,
        [payload, event.timestamp, createHash("sha256").update(payload).digest("hex")]
      );
      counts.audit += result.rowCount ?? 0;
    }
    continue;
  }

  for (const attachment of jsonLines<AttachmentReference>(raw)) {
    if (!attachment.id || !attachment.agentId || !attachment.sessionId || !attachment.createdAt) continue;
    try { await fs.access(attachment.storagePath); } catch { counts.missingAttachments += 1; continue; }
    const result = await databaseQuery(
      `INSERT INTO attachment_records (id, agent_id, session_id, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [attachment.id, attachment.agentId, attachment.sessionId, JSON.stringify(attachment), attachment.createdAt]
    );
    counts.attachments += result.rowCount ?? 0;
  }
}

console.log(JSON.stringify({ files: files.length, ...counts }));
await databasePool().end();
