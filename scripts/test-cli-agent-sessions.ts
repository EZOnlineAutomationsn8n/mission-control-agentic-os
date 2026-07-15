import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "cli-agent-sessions-"));
delete process.env.DATABASE_URL;
process.env.CLI_AGENT_SESSION_DATA_DIR = root;

const {
  createCliAgentSession,
  readCliAgentSession,
  updateCliAgentSession,
} = await import("../src/lib/cli-agents/session-store");

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("parallel agent session mutations preserve every agent record", async () => {
  const agents = ["hermes", "openclaw", "agy", "gemini", "codex"] as const;
  await Promise.all(agents.map((agentId) => createCliAgentSession(agentId, "parallel-proof")));

  const created = await Promise.all(agents.map((agentId) => readCliAgentSession(agentId, "parallel-proof")));
  assert.equal(created.every(Boolean), true);

  await Promise.all(agents.map((agentId) => updateCliAgentSession(agentId, "parallel-proof", {
    status: agentId === "gemini" ? "error" : "idle",
    active: agentId !== "gemini",
  })));

  const updated = await Promise.all(agents.map((agentId) => readCliAgentSession(agentId, "parallel-proof")));
  assert.deepEqual(updated.map((entry) => entry?.status), ["idle", "idle", "idle", "error", "idle"]);
});
