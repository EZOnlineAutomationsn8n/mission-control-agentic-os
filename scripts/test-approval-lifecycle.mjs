import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.APP_URL ?? "http://127.0.0.1:3210";
const approvalId = `approval-lifecycle-test-${Date.now()}`;
const connectorId = "approval-lifecycle-test-agent";
const reason = "focused test rejection reason";
const validRejection = {
  approvalId,
  connectorId,
  requestedCapability: "test-capability: production-write",
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
});
