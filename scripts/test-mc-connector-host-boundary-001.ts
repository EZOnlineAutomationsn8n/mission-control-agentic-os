import test from "node:test";
import assert from "node:assert/strict";

process.env.OPENCLAW_REQUIRE_LOCAL_PROCESS = "0";
process.env.OPENCLAW_HEALTH_URL = "http://127.0.0.1:18789/health";
process.env.FCC_HEALTH_URL = "http://127.0.0.1:8082/health";

const { readHermesLiveStatus } = await import("../src/lib/connectors/live/hermes-status");
const { readOpenClawLiveStatus } = await import("../src/lib/connectors/live/openclaw-status");
const { readFccLiveStatus } = await import("../src/lib/connectors/live/fcc-status");

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

test("unavailable host-only Hermes evidence is UNKNOWN, not a stopped gateway", async () => {
  const status = await readHermesLiveStatus();
  if (status.errors.some(x => x.includes("unreadable: gateway_state.json"))) {
    assert.equal(status.status, "unknown");
    assert.equal(status.pidAlive, null);
    assert.equal(status.commandExecution, false);
  } else {
    assert.notEqual(status.status, "connected"); // CI environment cannot claim unverified host status
  }
});

test("OpenClaw unavailable from container cannot prove host shutdown", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  const result = await readOpenClawLiveStatus();
  assert.equal(result.status, "unknown");
  assert.equal(result.gatewayReachable, false);
  assert.equal(result.commandExecution, false);
});

test("OpenClaw HTTP 200 with valid real health body is connected when remote process not required", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, status: "live" }), { status: 200 });
  const result = await readOpenClawLiveStatus();
  assert.equal(result.status, "connected");
  assert.equal(result.gatewayReachable, true);
});

test("OpenClaw HTTP 200 with unverified health body must not be connected", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ value: "something else" }), { status: 200 });
  const result = await readOpenClawLiveStatus();
  assert.equal(result.status, "degraded");
});

test("FCC network failure is unknown, not disconnected", async () => {
  globalThis.fetch = async () => { throw new TypeError("host-only loopback unreachable"); };
  const result = await readFccLiveStatus();
  assert.equal(result.status, "unknown");
  assert.equal(result.healthReachable, false);
  assert.equal(result.commandExecution, false);
});

test("FCC real healthy HTTP response is connected", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "healthy" }), { status: 200 });
  const result = await readFccLiveStatus();
  assert.equal(result.status, "connected");
  assert.equal(result.healthReachable, true);
});
