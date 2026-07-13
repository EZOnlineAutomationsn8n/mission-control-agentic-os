import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.APP_URL ?? "http://127.0.0.1:3210";
const runId = Date.now();
const approvalId = `approval-lifecycle-test-${runId}`;
const connectorId = "approval-lifecycle-test-agent";
const reason = "focused test rejection reason";
const dataFile = path.resolve("data", "approval-decisions.jsonl");
const validRejection = {
  approvalId,
  connectorId,
  requestedCapability: `test-capability: production-write-${runId}`,
  context: "Synthetic approval used only by the focused lifecycle test.",
  riskLevel: "high",
  requestedAt: new Date().toISOString(),
  status: "rejected",
  reason,
};

async function postDecision(body) {
  return fetch(`${BASE_URL}/api/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readTestDecisions() {
  const response = await fetch(
    `${BASE_URL}/api/approvals?connectorId=${encodeURIComponent(connectorId)}`,
    { cache: "no-store" }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.decisions));
  return body.decisions;
}

test("selected approval lifecycle is durable and idempotent", async (t) => {
  await t.test("invalid request body returns 400", async () => {
    const response = await postDecision({ connectorId });
    assert.equal(response.status, 400);
  });

  await t.test("rejected decision without a reason returns 400", async () => {
    const response = await postDecision({ ...validRejection, reason: "" });
    assert.equal(response.status, 400);
  });

  let persistedDecision;
  await t.test("rejected decision persists with its reason", async () => {
    const response = await postDecision(validRejection);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.decision.status, "rejected");
    assert.equal(body.decision.reason, reason);
    persistedDecision = body.decision;
  });

  await t.test("new decisions are dual-written for rollback compatibility", async () => {
    const lines = (await readFile(dataFile, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record) => record.requestedCapability === validRejection.requestedCapability);
    assert.ok(lines.some((record) => record.decision === "rejected"), "legacy rollback record must exist");
    assert.ok(lines.some((record) => record.status === "rejected"), "selected lifecycle record must exist");
  });

  await t.test("GET returns the persisted rejected decision", async () => {
    const decisions = await readTestDecisions();
    const decision = decisions.find((candidate) => candidate.approvalId === approvalId);
    assert.ok(decision, "persisted rejection must be returned by a fresh GET");
    assert.equal(decision.status, "rejected");
    assert.equal(decision.reason, reason);
  });

  await t.test("posting the same approval decision again is idempotent", async () => {
    const response = await postDecision(validRejection);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.alreadyDecided, true);
    assert.equal(body.decision.status, "rejected");
    assert.equal(body.decision.reason, reason);
    assert.equal(body.decision.decidedAt, persistedDecision.decidedAt);
  });

  await t.test("fresh lifecycle read remains rejected", async () => {
    const decisions = await readTestDecisions();
    const matching = decisions.filter((candidate) => candidate.approvalId === approvalId);
    assert.equal(matching.length, 1);
    assert.equal(matching[0].status, "rejected");
    assert.equal(matching[0].reason, reason);
  });

  await t.test("legacy live decision is normalized and remains rejected", async () => {
    const legacyConnectorId = `legacy-lifecycle-test-${Date.now()}`;
    const legacyCapability = "legacy-capability: protected-write";
    const legacyReason = "legacy rejection must survive promotion";
    const legacyAt = new Date().toISOString();
    await mkdir(path.dirname(dataFile), { recursive: true });
    await appendFile(
      dataFile,
      `${JSON.stringify({
        key: `${legacyConnectorId}::${legacyCapability}`,
        agentId: legacyConnectorId,
        requestedCapability: legacyCapability,
        decision: "rejected",
        reason: legacyReason,
        at: legacyAt,
      })}\n`,
      "utf8"
    );

    const firstRead = await fetch(
      `${BASE_URL}/api/approvals?connectorId=${encodeURIComponent(legacyConnectorId)}`,
      { cache: "no-store" }
    );
    assert.equal(firstRead.status, 200);
    const firstBody = await firstRead.json();
    assert.equal(firstBody.decisions.length, 1);
    assert.equal(firstBody.decisions[0].status, "rejected");
    assert.equal(firstBody.decisions[0].reason, legacyReason);
    assert.equal(firstBody.decisions[0].riskLevel, null);

    const idempotentPost = await postDecision({
      approvalId: `${legacyConnectorId}-approval-1`,
      connectorId: legacyConnectorId,
      requestedCapability: legacyCapability,
      context: "Selected-schema representation of the legacy approval.",
      riskLevel: "high",
      requestedAt: legacyAt,
      status: "rejected",
      reason: legacyReason,
    });
    assert.equal(idempotentPost.status, 200);
    const idempotentBody = await idempotentPost.json();
    assert.equal(idempotentBody.alreadyDecided, true);
    assert.equal(idempotentBody.decision.status, "rejected");

    const freshRead = await fetch(
      `${BASE_URL}/api/approvals?connectorId=${encodeURIComponent(legacyConnectorId)}`,
      { cache: "no-store" }
    );
    const freshBody = await freshRead.json();
    assert.equal(freshBody.decisions.length, 1);
    assert.equal(freshBody.decisions[0].status, "rejected");
    assert.equal(freshBody.decisions[0].reason, legacyReason);
  });
});
