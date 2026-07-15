import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the PostgreSQL integration test");

const suffix = `postgres-${Date.now()}`;
const root = await mkdtemp(path.join(tmpdir(), "mission-control-postgres-"));
process.env.ATTACHMENT_DATA_DIR = root;

const { databasePool, databaseQuery } = await import("../src/lib/persistence/database");
const { createCliAgentSession, readCliAgentSession, updateCliAgentSession } = await import("../src/lib/cli-agents/session-store");
const { appendConversationEntry, clearConversation, readConversation } = await import("../src/lib/agent-conversations/store");
const { appendAuditEvent, readAuditEvents } = await import("../src/lib/audit-log-store");
const { resolveAttachments, storeAttachments } = await import("../src/lib/attachments/store");

test.after(async () => {
  await databaseQuery("DELETE FROM agent_sessions WHERE session_key = $1", [suffix]);
  await databaseQuery("DELETE FROM conversation_entries WHERE session_id = $1", [suffix]);
  await databaseQuery("DELETE FROM audit_events WHERE payload->>'resultSummary' = $1", [suffix]);
  await databaseQuery("DELETE FROM attachment_records WHERE session_id = $1", [suffix]);
  await rm(root, { recursive: true, force: true });
  await databasePool().end();
  globalThis.missionControlDatabasePool = undefined;
});

test("PostgreSQL persists sessions, conversations, audit, and attachment metadata", async () => {
  await createCliAgentSession("hermes", suffix);
  await updateCliAgentSession("hermes", suffix, { status: "idle", active: true });
  assert.equal((await readCliAgentSession("hermes", suffix))?.status, "idle");

  const now = new Date().toISOString();
  await appendConversationEntry({
    id: suffix,
    agentId: "hermes",
    sessionId: suffix,
    prompt: "persistence proof",
    status: "completed",
    text: "POSTGRES_CONVERSATION_PASS",
    error: null,
    transportModelAlias: null,
    actualRuntimeModel: null,
    attempts: [],
    routeCount: null,
    skippedRouteNumbers: [],
    durationMs: 1,
    createdAt: now,
    completedAt: now,
  });
  assert.equal((await readConversation("hermes", suffix))[0]?.text, "POSTGRES_CONVERSATION_PASS");

  assert.equal((await appendAuditEvent({
    timestamp: now,
    connectorId: "postgres-proof",
    actionType: "integration-test",
    status: "completed",
    resultSummary: suffix,
  })).ok, true);
  assert.equal((await readAuditEvents()).some((entry) => entry.resultSummary === suffix), true);

  const [attachment] = await storeAttachments({
    agentId: "hermes",
    sessionId: suffix,
    files: [new File(["database metadata proof"], "proof.txt", { type: "text/plain" })],
  });
  assert.equal((await resolveAttachments({ agentId: "hermes", sessionId: suffix, ids: [attachment.id] }))[0]?.id, attachment.id);
  assert.equal(await clearConversation("hermes", suffix), 1);
});
