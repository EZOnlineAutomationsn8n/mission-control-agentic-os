import test from "node:test";
import assert from "node:assert/strict";
import { databasePool } from "../src/lib/persistence/database";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3330";
const runId = Date.now();
const approvalId = `approval-postgres-${runId}`;
const connectorId = "approval-staging-acceptance";
const requestedCapability = `protected-write-${runId}`;
const reason = "STAGING TEST — rejection persistence proof";
const payload = {
  approvalId,
  connectorId,
  requestedCapability,
  context: "PostgreSQL approval lifecycle acceptance test.",
  riskLevel: "high",
  requestedAt: new Date().toISOString(),
  status: "rejected",
  reason,
};

async function postDecision() {
  return fetch(`${baseUrl}/api/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("approval decision survives through PostgreSQL and fresh API reads", async () => {
  const first = await postDecision();
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.decision.status, "rejected");
  assert.equal(firstBody.decision.reason, reason);

  const stored = await databasePool().query(
    `SELECT approval_id, status, reason FROM approval_decisions
     WHERE approval_id = $1`,
    [approvalId]
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].status, "rejected");
  assert.equal(stored.rows[0].reason, reason);

  const fresh = await fetch(
    `${baseUrl}/api/approvals?connectorId=${encodeURIComponent(connectorId)}`,
    { cache: "no-store" }
  );
  assert.equal(fresh.status, 200);
  const freshBody = await fresh.json();
  const decision = freshBody.decisions.find((candidate: { approvalId: string }) => candidate.approvalId === approvalId);
  assert.ok(decision);
  assert.equal(decision.status, "rejected");
  assert.equal(decision.reason, reason);

  const repeated = await postDecision();
  assert.equal(repeated.status, 200);
  const repeatedBody = await repeated.json();
  assert.equal(repeatedBody.alreadyDecided, true);
  assert.equal(repeatedBody.decision.decidedAt, firstBody.decision.decidedAt);

  const count = await databasePool().query(
    `SELECT COUNT(*)::int AS count FROM approval_decisions
     WHERE connector_id = $1 AND requested_capability = $2`,
    [connectorId, requestedCapability]
  );
  assert.equal(count.rows[0].count, 1);
});

test.after(async () => {
  await databasePool().end();
});
