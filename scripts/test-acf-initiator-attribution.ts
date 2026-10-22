import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "mc-acf-initiator-"));
const workspace = path.join(root, "workspace");
const hermes = path.join(root, "fake-hermes.mjs");
await mkdir(workspace, { recursive: true });

await writeFile(hermes, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("Hermes fake 1.0");
  process.exit(0);
}
if (args[0] === "config" && args[1] === "get" && args[2] === "model.default") {
  console.log("fake-model");
  process.exit(0);
}
if (args[0] === "config" && args[1] === "get" && args[2] === "model.provider") {
  console.log("fake-provider");
  process.exit(0);
}
if (args[0] === "chat") {
  console.log("FAKE_HERMES_REPLY");
  console.log("session_id: hermes-native-proof");
  process.exit(0);
}
console.error("unexpected fake Hermes args: " + JSON.stringify(args));
process.exit(2);
`, "utf8");
await chmod(hermes, 0o755);

delete process.env.DATABASE_URL;
process.env.CLI_AGENT_SESSION_DATA_DIR = root;
process.env.AGENT_CONVERSATION_DATA_DIR = root;
process.env.AUDIT_DATA_DIR = root;
process.env.MISSION_CONTROL_AGENT_WORKSPACE = workspace;
process.env.HERMES_AGENT_BINARY = hermes;

const { createCliAgentSession, updateCliAgentSession } = await import("../src/lib/cli-agents/session-store");
const { askCliAgent } = await import("../src/lib/cli-agents/api");
const { readConversation } = await import("../src/lib/agent-conversations/store");
const { readAuditEvents } = await import("../src/lib/audit-log-store");

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("operator turns remain operator-attributed while ACF participant claims are explicit and unverified", async () => {
  await createCliAgentSession("hermes", "acf-proof");
  await updateCliAgentSession("hermes", "acf-proof", {
    runtimeSessionId: "hermes-native-proof",
    status: "idle",
    active: true,
  });

  const operatorResponse = await askCliAgent(new Request("http://local/api/connectors/hermes/actions/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "acf-proof", prompt: "operator turn" }),
  }), "hermes");
  assert.equal(operatorResponse.status, 200);
  const operatorTurn = await operatorResponse.json();
  assert.equal(operatorTurn.initiator, undefined);
  assert.equal(operatorTurn.initiatorVerified, undefined);

  const initiator = {
    kind: "acf-participant-dialogue",
    runId: "RUN-ACF-DLG-02-LIVE-1",
    role: "researcher",
    participantId: "hermes",
    turnId: "turn-1",
  } as const;

  const acfResponse = await askCliAgent(new Request("http://local/api/connectors/hermes/actions/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "acf-proof", prompt: "acf turn", initiator }),
  }), "hermes");
  assert.equal(acfResponse.status, 200);
  const acfTurn = await acfResponse.json();
  assert.deepEqual(acfTurn.initiator, initiator);
  assert.equal(acfTurn.initiatorVerified, false);

  const history = await readConversation("hermes", "acf-proof");
  assert.equal(history.length, 2);
  assert.equal(history[0].initiator, undefined);
  assert.deepEqual(history[1].initiator, initiator);
  assert.equal(history[1].initiatorVerified, false);

  const audits = await readAuditEvents();
  const operatorAudit = audits.find((event) => event.actionType === "hermes-agent-turn" && event.actor === "operator");
  const acfAudit = audits.find((event) => event.actionType === "hermes-agent-turn" && event.actor === "acf:RUN-ACF-DLG-02-LIVE-1:researcher");
  assert.ok(operatorAudit);
  assert.ok(acfAudit);
  assert.deepEqual(acfAudit?.initiator, initiator);
  assert.equal(acfAudit?.initiatorVerified, false);
});

test("caller cannot claim operator identity through initiator and malformed claims fail closed", async () => {
  const before = (await readConversation("hermes", "acf-proof")).length;

  const impersonation = await askCliAgent(new Request("http://local/api/connectors/hermes/actions/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "acf-proof",
      prompt: "must not run",
      initiator: { kind: "operator" },
    }),
  }), "hermes");
  assert.equal(impersonation.status, 400);
  assert.match((await impersonation.json()).error, /operator turns must omit initiator/);

  const extraField = await askCliAgent(new Request("http://local/api/connectors/hermes/actions/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "acf-proof",
      prompt: "must not run",
      initiator: {
        kind: "acf-participant-dialogue",
        runId: "RUN-1",
        role: "researcher",
        participantId: "hermes",
        turnId: "turn-2",
        verified: true,
      },
    }),
  }), "hermes");
  assert.equal(extraField.status, 400);

  const after = (await readConversation("hermes", "acf-proof")).length;
  assert.equal(after, before);
});
