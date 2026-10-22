import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await mkdtemp(path.join(os.tmpdir(), "omi-outbound-"));
const outbox = path.join(tmp, "outbox");
const state = path.join(tmp, "state");
await mkdir(outbox, { recursive: true });
process.env.OMI_OUTBOX_DIR = outbox;
process.env.OMI_OUTBOUND_STATE_DIR = state;
process.env.OMI_DEV_KEY = "omi_dev_test_only_not_real";
process.env.OMI_DEV_MEMORY_URL = "https://example.invalid/v1/dev/user/memories";
process.env.OMI_OUTBOUND_AUTHORITY = "DENNIS_WO_SBC_05_20261003";

const { runOmiOutboundOnce, omiOutboundTestSupport } = await import("../src/lib/connectors/live/omi-outbound");

const candidate = {
  status: "PENDING_OPERATOR_APPROVAL",
  send_enabled: false,
  origin: "shared-brain",
  project: "global",
  item_id: "SEM-test-1",
  slot: "DENNIS_INTENT",
  text: "Dennis wants durable semantic memory [shared-brain-export] (global, source CAP-test)",
  source_record: "CAP-test",
  prepared_at: "2026-10-03T00:00:00Z",
};

async function resetFiles() {
  await rm(outbox, { recursive: true, force: true });
  await rm(state, { recursive: true, force: true });
  await mkdir(outbox, { recursive: true });
  await writeFile(path.join(outbox, "PENDING_test.json"), JSON.stringify(candidate, null, 2) + "\n");
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("candidate contract and wire marker", () => {
  const v = omiOutboundTestSupport.validateCandidate(candidate);
  const hash = omiOutboundTestSupport.sourceHash(JSON.stringify(candidate));
  const key = omiOutboundTestSupport.candidateKey(v, hash);
  const text = omiOutboundTestSupport.wireText(v, key);
  assert.match(text, /^\[shared-brain-export:[a-f0-9]{24}\]/);
  assert.ok(text.length <= 500);
  assert.throws(() => omiOutboundTestSupport.validateCandidate({ ...candidate, slot: "BLOCKER" }));
});

test("first delivery is read-back certified and second run is exactly-once", async () => {
  await resetFiles();
  let posts = 0;
  let gets = 0;
  let remote: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts += 1;
      const body = JSON.parse(String(init.body));
      remote = [{ id: "mem-1", content: body.content }];
      return jsonResponse({ id: "mem-1" });
    }
    gets += 1;
    return jsonResponse(remote);
  }) as typeof fetch;
  const first = await runOmiOutboundOnce();
  assert.equal(first.sent, 1);
  assert.equal(first.failed, 0);
  assert.equal(posts, 1);
  assert.ok(gets >= 2);
  const second = await runOmiOutboundOnce();
  assert.equal(second.alreadySent, 1);
  assert.equal(posts, 1);
  const files = await readdir(state);
  assert.equal(files.filter(f => f.startsWith("SENT_")).length, 1);
});

test("successful POST without readback is never auto-reposted and later reconciles", async () => {
  await resetFiles();
  let posts = 0;
  let expose = false;
  let postedText = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts += 1;
      postedText = JSON.parse(String(init.body)).content;
      return jsonResponse({ id: "mem-uncertain" });
    }
    return jsonResponse(expose ? [{ id: "mem-uncertain", content: postedText }] : []);
  }) as typeof fetch;
  const first = await runOmiOutboundOnce();
  assert.equal(first.uncertain, 1);
  assert.equal(posts, 1);
  const second = await runOmiOutboundOnce();
  assert.equal(second.uncertain, 1);
  assert.equal(posts, 1);
  expose = true;
  const third = await runOmiOutboundOnce();
  assert.equal(third.reconciled, 1);
  assert.equal(posts, 1);
  const files = await readdir(state);
  assert.equal(files.filter(f => f.startsWith("SENT_")).length, 1);
  assert.equal(files.filter(f => f.startsWith("DELIVERY_UNCERTAIN_")).length, 0);
});

test("authority marker is mandatory", async () => {
  await resetFiles();
  delete process.env.OMI_OUTBOUND_AUTHORITY;
  await assert.rejects(runOmiOutboundOnce(), /authority marker missing/);
  process.env.OMI_OUTBOUND_AUTHORITY = "DENNIS_WO_SBC_05_20261003";
});

await rm(tmp, { recursive: true, force: true });
console.log("OMI_OUTBOUND_TESTS=PASS");
