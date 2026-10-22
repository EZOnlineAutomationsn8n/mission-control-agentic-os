import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClaudeCodeSession } from "../src/lib/claude-code/session-store";

const root = await mkdtemp(path.join(os.tmpdir(), "mc-claude-retry-safety-"));
const workspace = path.join(root, "workspace");
const home = path.join(root, "home");
const launcher = path.join(root, "fake-claude.mjs");
const secondRouteMarker = path.join(root, "second-route-called");
await mkdir(workspace, { recursive: true });
await mkdir(home, { recursive: true });
process.env.HOME = home;
process.env.CLAUDE_CODE_LAUNCHER = process.execPath;
process.env.CLAUDE_CODE_LAUNCHER_ARGS_JSON = JSON.stringify([launcher]);
process.env.CLAUDE_CODE_SKIP_ROUTE_PREFLIGHT = "1";
process.env.CLAUDE_CODE_TIMEOUT_MS = "10000";
process.env.CLAUDE_CODE_ROUTE_TIMEOUT_MS = "5000";

await writeFile(launcher, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.test"); process.exit(0); }
const idFlag = args.indexOf("--session-id");
const resumeFlag = args.indexOf("--resume");
const sessionId = args[idFlag >= 0 ? idFlag + 1 : resumeFlag + 1];
if (args.includes("--model")) {
  console.error("explicit --model must not be passed through the FCC launcher");
  process.exit(64);
}
const model = process.env.CLAUDE_MODEL || "";
if (model.includes("laguna-xs-2.1")) {
  const dir = path.join(process.env.HOME, ".claude", "projects", "-workspace-projects-mission-control");
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, sessionId + ".jsonl"), JSON.stringify({ prompt: args.at(-1) }) + "\\n");
  process.stderr.write("simulated transport failure after native session mutation\\n");
  process.exit(17);
}
writeFileSync(${JSON.stringify("SECOND_ROUTE_MARKER")}, "called\\n");
console.log(JSON.stringify({ type: "result", is_error: false, result: "UNSAFE_SECOND_ROUTE", session_id: sessionId, modelUsage: { [model]: {} }, permission_denials: [] }));
`, "utf8");
await chmod(launcher, 0o755);

const fakeLauncherSource = await readFile(launcher, "utf8");
await writeFile(launcher, fakeLauncherSource.replace("SECOND_ROUTE_MARKER", secondRouteMarker.replaceAll("\\", "\\\\")), "utf8");

const { runClaudeCodeTurn } = await import("../src/lib/claude-code/runner");
const now = new Date().toISOString();
const session: ClaudeCodeSession = {
  sessionKey: "retry-safety",
  claudeSessionId: "11111111-1111-4111-8111-111111111111",
  displayName: "mission-control-retry-safety",
  workspace,
  permissionMode: "acceptEdits",
  executionMode: "on-demand-cli",
  status: "idle",
  active: true,
  createdAt: now,
  updatedAt: now,
  lastError: null,
};

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("a failed route that mutates the persistent Claude session is never replayed through another route", async () => {
  const result = await runClaudeCodeTurn({ session, prompt: "READ_ONLY_SMOKE", create: true });
  assert.equal(result.status, "failed");
  assert.equal(result.sessionState, "error");
  assert.equal(result.attempts?.length, 1);
  assert.equal(result.attempts?.[0]?.transportModelAlias, "open_router/poolside/laguna-xs-2.1:free");
  assert.match(result.error ?? "", /retry suppressed because the persistent Claude Code session changed/);
  await assert.rejects(readFile(secondRouteMarker, "utf8"), { code: "ENOENT" });
});
