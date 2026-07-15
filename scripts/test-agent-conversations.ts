import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "agent-conversations-"));
delete process.env.DATABASE_URL;
process.env.AGENT_CONVERSATION_DATA_DIR = root;
process.env.AUDIT_DATA_DIR = root;

const { executeConversationRequest } = await import("../src/lib/agent-conversations/service");
const { readConversation } = await import("../src/lib/agent-conversations/store");
const { readAuditEvents } = await import("../src/lib/audit-log-store");
const conversationRoute = await import("../src/app/api/agent-conversations/[agentId]/[sessionId]/route");

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("successful and failed FCC-shaped requests persist and are audited", async () => {
  const success = await executeConversationRequest({
    agentId: "claude-fcc", sessionId: "session-a", prompt: "success prompt", actionType: "fcc-ask",
    run: async () => ({
      status: "completed", text: "FCC_COCKPIT_PASS", error: null,
      transportModelAlias: "route-alias", actualRuntimeModel: "runtime-model",
      attempts: [{ routeNumber: 1, transportModelAlias: "route-alias", actualRuntimeModel: "runtime-model", outcome: "completed", error: null, latencyMs: 12 }],
      routeCount: 10, skippedRouteNumbers: [],
    }),
  });
  assert.equal(success.entry.text, "FCC_COCKPIT_PASS");
  assert.equal(success.auditRecorded, true);

  const failure = await executeConversationRequest({
    agentId: "claude-fcc", sessionId: "session-a", prompt: "failure prompt", actionType: "fcc-ask",
    run: async () => { throw new Error("controlled connector failure"); },
  });
  assert.equal(failure.entry.status, "failed");
  assert.match(failure.entry.error ?? "", /controlled connector failure/);
  assert.equal(failure.auditRecorded, true);

  const refreshed = await readConversation("claude-fcc", "session-a");
  assert.deepEqual(refreshed.map((entry) => entry.prompt), ["success prompt", "failure prompt"]);
  const audits = await readAuditEvents();
  assert.equal(audits.filter((event) => event.connectorId === "claude-fcc" && event.actionType === "fcc-ask").length, 2);
});

test("conversation history is isolated by agent and session", async () => {
  await executeConversationRequest({
    agentId: "hermes", sessionId: "session-a", prompt: "hermes", actionType: "test",
    run: async () => ({ status: "completed", text: "ok", error: null }),
  });
  await executeConversationRequest({
    agentId: "claude-fcc", sessionId: "session-b", prompt: "other session", actionType: "test",
    run: async () => ({ status: "completed", text: "ok", error: null }),
  });
  assert.deepEqual((await readConversation("hermes", "session-a")).map((entry) => entry.prompt), ["hermes"]);
  assert.deepEqual((await readConversation("claude-fcc", "session-b")).map((entry) => entry.prompt), ["other session"]);
  assert.equal((await readConversation("openclaw", "session-a")).length, 0);
});

test("clear requires exact backend confirmation and records audit evidence", async () => {
  const context = { params: Promise.resolve({ agentId: "claude-fcc", sessionId: "session-b" }) };
  const rejected = await conversationRoute.DELETE(new Request("http://local", {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "yes" }),
  }), context);
  assert.equal(rejected.status, 409);
  assert.equal((await readConversation("claude-fcc", "session-b")).length, 1);

  const accepted = await conversationRoute.DELETE(new Request("http://local", {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "CLEAR CONVERSATION" }),
  }), context);
  assert.equal(accepted.status, 200);
  assert.equal((await readConversation("claude-fcc", "session-b")).length, 0);
  const auditRaw = await readFile(path.join(root, "audit-log.jsonl"), "utf8");
  assert.match(auditRaw, /conversation-clear/);
});
