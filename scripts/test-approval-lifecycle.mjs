// Focused end-to-end test for the approval-decision persistence lifecycle.
// Runs against the app on http://127.0.0.1:3300 (must be running).
// Uses a synthetic agentId ("lifecycle-test-agent") so it never collides
// with real connector approvals.
//
// Run: node --test scripts/test-approval-lifecycle.mjs

import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3300";
const AGENT = "lifecycle-test-agent";
const CAP = `test-capability-${Date.now()}`;
const KEY = `${AGENT}::${CAP}`;

test("POST rejects invalid body", async () => {
  const res = await fetch(`${BASE}/api/approvals/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: AGENT }), // missing capability + decision
  });
  assert.equal(res.status, 400);
});

test("rejection is persisted with reason and survives re-read", async () => {
  const post = await fetch(`${BASE}/api/approvals/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: AGENT,
      requestedCapability: CAP,
      decision: "rejected",
      reason: "not safe for production",
    }),
  });
  assert.equal(post.status, 200);
  assert.equal((await post.json()).ok, true);

  const get = await fetch(`${BASE}/api/approvals/decisions`, { cache: "no-store" });
  assert.equal(get.status, 200);
  const { decisions } = await get.json();
  assert.ok(decisions[KEY], "decision must be present after re-read (fresh request = fresh server read)");
  assert.equal(decisions[KEY].decision, "rejected");
  assert.equal(decisions[KEY].reason, "not safe for production");
});

test("latest decision per key wins", async () => {
  const post = await fetch(`${BASE}/api/approvals/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: AGENT,
      requestedCapability: CAP,
      decision: "approved",
      reason: "re-reviewed and allowed",
    }),
  });
  assert.equal(post.status, 200);

  const get = await fetch(`${BASE}/api/approvals/decisions`, { cache: "no-store" });
  const { decisions } = await get.json();
  assert.equal(decisions[KEY].decision, "approved");
  assert.equal(decisions[KEY].reason, "re-reviewed and allowed");
});
