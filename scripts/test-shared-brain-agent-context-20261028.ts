/**
 * Shared Brain "schakelaartje": CLI agents (Hermes, OpenClaw, Gemini, Codex, AGY) get the same
 * brain packet as Claude Code. Real brain CLI and real project_map on this host; the injection
 * log is the brain's own _system/context_injections.jsonl (runtime + session id per record).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { accessSync, constants, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brainAgentContextEnabled, brainContextForTurn, lastInjectedSha, parsePacketHeader, projectFromMap,
  recordInjectedSha, withBrainContext } from "../src/lib/shared-brain/agent-context";

const BRAIN = process.env.SHARED_BRAIN_ROOT || "/workspace/projects/agentic-os-brain";
const LOG = join(BRAIN, "_system", "context_injections.jsonl");
process.env.CLI_AGENT_SESSION_DATA_DIR = mkdtempSync(join(tmpdir(), "brain-inj-"));
delete process.env.MC_PREVIEW;

test("B1 project_map longest-prefix resolution (real map)", () => {
  const tsv = readFileSync(join(BRAIN, "_system", "project_map.tsv"), "utf8");
  assert.equal(projectFromMap(tsv, "/workspace/projects/mission-control"), "mission-control");
  assert.equal(projectFromMap(tsv, "/workspace/projects/mission-control/src"), "mission-control");
  assert.equal(projectFromMap(tsv, "/workspace/projects/agentic-os-brain/_system/cert-workspace"), "continuum-cert");
  assert.equal(projectFromMap(tsv, "/workspace/projects/mission-controlX"), null);
  assert.equal(projectFromMap(tsv, "/tmp"), null);
});

test("B2 header parse and prompt wrapping keep Dennis's prompt last and intact", () => {
  assert.deepEqual(parsePacketHeader("<<<SHARED_BRAIN_PACKET project=mission-control packet_sha=1e887dfa90979414\n#"),
    { project: "mission-control", packetSha: "1e887dfa90979414" });
  assert.equal(parsePacketHeader("no packet"), null);
  const out = withBrainContext("Goedemorgen, gasten.", { project: "p", packetSha: "abcdef12", text: "PACKET" });
  assert.ok(out.startsWith("[Shared Brain — read-only context."));
  assert.ok(out.endsWith("\n\nGoedemorgen, gasten."));
  assert.equal(withBrainContext("x", null), "x");
});

test("B3 disabled in preview and by switch", () => {
  assert.equal(brainAgentContextEnabled({ MC_PREVIEW: "1" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(brainAgentContextEnabled({ SHARED_BRAIN_AGENT_CONTEXT: "off" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(brainAgentContextEnabled({} as unknown as NodeJS.ProcessEnv), true);
});

function logWritable(): boolean {
  try { accessSync(LOG, constants.W_OK); return true; } catch { return false; }
}

test("B4 real brain: first turn injects + logs as hermes; same packet is not injected twice", async (t) => {
  const sid = "brain-ctx-test-" + Date.now();
  const first = await brainContextForTurn({ runtime: "hermes", sessionKey: sid, workspace: "/workspace/projects/mission-control" });
  if (!logWritable()) {
    // REM_DESK test sandbox mounts the brain read-only: brain context cannot log, so nothing is
    // injected and the turn proceeds (fail-open). Real logging is proven in LIVE after release.
    assert.equal(first, null, "read-only brain must fail open without a packet");
    t.diagnostic("brain log read-only in this sandbox: fail-open verified; LIVE proof required");
    return;
  }
  assert.ok(first, "packet expected for mission-control");
  assert.equal(first!.project, "mission-control");
  assert.ok(first!.text.includes("SHARED_BRAIN_PACKET") && first!.text.length > 500);
  const lines = readFileSync(LOG, "utf8").trim().split("\n");
  const rec = JSON.parse(lines[lines.length - 1]);
  assert.equal(rec.runtime, "hermes"); assert.equal(rec.session_id, sid); assert.equal(rec.project, "mission-control");
  assert.equal(rec.packet_sha, first!.packetSha);
  await recordInjectedSha("hermes", sid, first!.packetSha);
  assert.equal(await lastInjectedSha("hermes", sid), first!.packetSha);
  const second = await brainContextForTurn({ runtime: "hermes", sessionKey: sid, workspace: "/workspace/projects/mission-control" });
  assert.equal(second, null, "unchanged packet is not injected again");
});

test("B4b injection memory per agent session (no brain needed)", async () => {
  await recordInjectedSha("codex", "s1", "aaaa1111");
  assert.equal(await lastInjectedSha("codex", "s1"), "aaaa1111");
  assert.equal(await lastInjectedSha("hermes", "s1"), null);
  assert.equal(await lastInjectedSha("codex", "s2"), null);
});

test("B5 unmapped workspace: no packet, no failure", async () => {
  assert.equal(await brainContextForTurn({ runtime: "gemini", sessionKey: "x", workspace: "/tmp/nowhere" }), null);
});

test("B6 api wiring: packet goes into the runtime prompt only; sha recorded only after a completed turn", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/cli-agents/api.ts"), "utf8");
  assert.match(src, /brainContextForTurn\(\{ runtime: agentId, sessionKey: key, workspace: session\.workspace \}\)/);
  assert.match(src, /runAgentTurn\(agentId, session, withBrainContext\(effectivePrompt, brain\)/);
  assert.match(src, /prompt: prompt\.trim\(\),/);
  assert.match(src, /if \(brain && persisted\.entry\.status === "completed"\) await recordInjectedSha\(agentId, key, brain\.packetSha\);/);
});
