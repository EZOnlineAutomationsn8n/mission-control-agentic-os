import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateRecoveryOperator, validateLiveOperator } from "../src/lib/claude-code/recovery-operator-auth";
import { POST as POST_ASK } from "../src/app/api/connectors/claude-code/actions/ask/route";

const KEY = "acf-werkplaats-claude-code";
const UUID = "471b3444-dd79-4bd9-b7cd-3023258cac63";
const ENV = ["MC_PREVIEW", "GAOS_STAGE_NATIVE_ISOLATED", "DATABASE_URL", "CLAUDE_CODE_SESSION_DATA_DIR",
  "AGENT_CONVERSATION_DATA_DIR", "AUDIT_DATA_DIR"];

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  const oldFetch = globalThis.fetch;
  try {
    for (const k of ENV) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    await fn();
  } finally {
    globalThis.fetch = oldFetch;
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
function liveReq(origin = "https://mc.vireonhq.cloud", auth = "Basic YWFhYWFhYWFhYWFh") {
  return new Request("http://local.invalid/x", { method: "POST",
    headers: { origin, authorization: auth, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: "{}" });
}

test("A1 Werkplaats AGENTS MODE never performs owner recovery (real row lives at LIVE owner)", async () => {
  await withEnv({ MC_PREVIEW: "1", GAOS_STAGE_NATIVE_ISOLATED: "0" }, async () => {
    assert.equal(await validateRecoveryOperator(liveReq()), "RECOVERY_RUNS_AT_LIVE_OWNER_USE_LIVE_MISSION_CONTROL");
  });
});
test("A2 LIVE without owner database is refused", async () => {
  await withEnv({}, async () => {
    assert.equal(await validateLiveOperator(liveReq()), "RECOVERY_LIVE_OWNER_DATABASE_REQUIRED");
  });
});
test("A3 LIVE owner: wrong origin, missing login, preview identity all refused; no unmocked fetch", async () => {
  await withEnv({ DATABASE_URL: "postgres://fixture.invalid/db" }, async () => {
    globalThis.fetch = async (u: RequestInfo | URL) => {
      assert.equal(String(u), "https://mc.vireonhq.cloud/api/preview-identity");
      return Response.json({ preview: true });
    };
    assert.equal(await validateLiveOperator(liveReq("https://mc.vireonhq.cloud:8443")), "ORIGIN_MISMATCH");
    assert.equal(await validateLiveOperator(liveReq(undefined, "Bearer x")), "LIVE_LOGIN_REQUIRED");
    assert.equal(await validateLiveOperator(liveReq()), "NOT_LIVE_IDENTITY");
  });
});
test("A4 LIVE owner: realm accepts and identity is LIVE → authorized", async () => {
  await withEnv({ DATABASE_URL: "postgres://fixture.invalid/db" }, async () => {
    globalThis.fetch = async () => Response.json({ preview: false });
    assert.equal(await validateLiveOperator(liveReq()), null);
  });
});
test("A5 LIVE owner: realm rejects (401) → refused", async () => {
  await withEnv({ DATABASE_URL: "postgres://fixture.invalid/db" }, async () => {
    globalThis.fetch = async () => new Response("no", { status: 401 });
    assert.equal(await validateLiveOperator(liveReq()), "LIVE_LOGIN_INVALID");
  });
});

async function resumeFixture(row: Record<string, unknown>, fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "gaos-r2-resume-"));
  try {
    await withEnv({ MC_PREVIEW: "1", GAOS_STAGE_NATIVE_ISOLATED: "1", CLAUDE_CODE_SESSION_DATA_DIR: dir,
      AGENT_CONVERSATION_DATA_DIR: dir, AUDIT_DATA_DIR: dir }, async () => {
      globalThis.fetch = async () => Response.json({ preview: true });
      await writeFile(path.join(dir, "claude-code-sessions.json"), JSON.stringify({ [KEY]: row }));
      await fn(dir);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const held = { sessionKey: KEY, claudeSessionId: UUID, displayName: "fixture", workspace: "/isolated-r2-fixture",
  permissionMode: "plan", executionMode: "on-demand-cli", status: "prepared", active: true,
  createdAt: "2026-10-22T14:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z", lastError: null,
  historyLastError: "FIXTURE_UNRECOGNIZED_MODEL", recoveryHold: true };
function askReq(extra: Record<string, unknown>, operator = true) {
  return new Request("http://local.invalid/api/connectors/claude-code/actions/ask", { method: "POST",
    headers: { "content-type": "application/json", ...(operator ? { origin: "https://mc.vireonhq.cloud:8443",
      authorization: "Basic YWFhYWFhYWFhYWFh", "sec-fetch-site": "same-origin" } : {}) },
    body: JSON.stringify({ sessionId: KEY, prompt: "herstelcontrole", ...extra }) });
}

test("B1 hold: ordinary prompt never dispatches", async () => {
  await resumeFixture(held, async (dir) => {
    const r = await POST_ASK(askReq({}));
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "CLAUDE_R2_RECOVERY_HOLD_USE_RECOVERY_RESUME");
    const after = JSON.parse(await readFile(path.join(dir, "claude-code-sessions.json"), "utf8"))[KEY];
    assert.deepEqual(after, held, "row unchanged");
  });
});
test("B2 hold: resume without operator login refused, row unchanged", async () => {
  await resumeFixture(held, async (dir) => {
    const r = await POST_ASK(askReq({ recoveryResume: true }, false));
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "claude-code-sessions.json"), "utf8"))[KEY], held);
  });
});
test("B3 exactly-once: an already attempted resume is never retried", async () => {
  const attempted = { ...held, status: "prepared", recoveryTurnStartedAt: "2026-10-28T00:01:00.000Z" };
  await resumeFixture(attempted, async (dir) => {
    const r = await POST_ASK(askReq({ recoveryResume: true }));
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "CLAUDE_R2_RECOVERY_TURN_ALREADY_ATTEMPTED_NO_RETRY");
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "claude-code-sessions.json"), "utf8"))[KEY], attempted);
  });
});
test("B4 hold with non-prepared status (running/unknown) refuses, no dispatch", async () => {
  const running = { ...held, status: "running" };
  await resumeFixture(running, async () => {
    const r = await POST_ASK(askReq({ recoveryResume: true }));
    assert.equal(r.status, 409);
  });
});
