// ACF-MC-CONTINUOUS-CONVERSATION-RECOVERY-20261020-001: a failed route that only recorded the operator's prompt
// (nothing executed) may move on to the next route; a failed route that left any assistant output or tool call is
// still never replayed (exactly-once). Companion of test-claude-code-retry-safety.ts (unchanged, still passing).
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClaudeCodeSession } from "../src/lib/claude-code/session-store";

const root = await mkdtemp(path.join(os.tmpdir(), "mc-claude-prompt-only-"));
const workspace = path.join(root, "workspace");
const home = path.join(root, "home");
const launcher = path.join(root, "fake-claude.mjs");
const marker = path.join(root, "second-route-called");
await mkdir(workspace, { recursive: true });
await mkdir(home, { recursive: true });
process.env.HOME = home;
process.env.CLAUDE_CODE_LAUNCHER = process.execPath;
process.env.CLAUDE_CODE_LAUNCHER_ARGS_JSON = JSON.stringify([launcher]);
process.env.CLAUDE_CODE_SKIP_ROUTE_PREFLIGHT = "1";
process.env.CLAUDE_CODE_TIMEOUT_MS = "15000";
process.env.CLAUDE_CODE_ROUTE_TIMEOUT_MS = "5000";

await writeFile(launcher, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("2.1.test"); process.exit(0); }
const idFlag = args.indexOf("--session-id");
const resumeFlag = args.indexOf("--resume");
const sessionId = args[idFlag >= 0 ? idFlag + 1 : resumeFlag + 1];
const model = process.env.CLAUDE_MODEL || "";
const dir = path.join(process.env.HOME, ".claude", "projects", "-workspace-projects-mission-control");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, sessionId + ".jsonl");
if (model.includes("laguna-xs-2.1")) {
  for (const meta of ["custom-title", "agent-name", "queue-operation", "attachment", "atis-latch"]) appendFileSync(file, JSON.stringify({ type: meta }) + "\\n");
  appendFileSync(file, JSON.stringify({ type: "user", message: { role: "user", content: args.at(-1) } }) + "\\n");
  for (const meta of ["last-prompt", "cost-state"]) appendFileSync(file, JSON.stringify({ type: meta }) + "\\n");
  if (process.env.FAKE_MODE === "api_error_text") {
    appendFileSync(file, JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "API Error: model unavailable" }] } }) + "\\n");
  }
  if (process.env.FAKE_MODE === "assistant_tool") {
    appendFileSync(file, JSON.stringify({ type: "assistant", message: { role: "assistant",
      content: [{ type: "tool_use", name: "Bash", input: { command: "touch x" } }] } }) + "\\n");
  }
  process.stderr.write("[claude-code:unrecognized_model] simulated provider refusal\\n");
  process.exit(17);
}
writeFileSync(${JSON.stringify("MARKER")}, model + "\\n");
appendFileSync(file, JSON.stringify({ type: "assistant", message: { role: "assistant", content: "ROUTE2_OK" } }) + "\\n");
console.log(JSON.stringify({ type: "result", is_error: false, result: "ROUTE2_OK", session_id: sessionId, modelUsage: { [model]: {} }, permission_denials: [] }));
`.replace("MARKER", marker.replaceAll("\\", "\\\\")), "utf8");
await chmod(launcher, 0o755);

const { runClaudeCodeTurn } = await import("../src/lib/claude-code/runner");
const now = new Date().toISOString();
const session = (id: string): ClaudeCodeSession => ({
  sessionKey: "prompt-only-" + id.slice(0, 4), claudeSessionId: id, displayName: "mission-control-prompt-only",
  workspace, permissionMode: "acceptEdits", executionMode: "on-demand-cli", status: "idle", active: true,
  createdAt: now, updatedAt: now, lastError: null,
});

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("a failed route that only recorded the prompt reroutes and the turn completes on the next route", async () => {
  process.env.FAKE_MODE = "prompt_only";
  const result = await runClaudeCodeTurn({ session: session("22222222-2222-4222-8222-222222222222"), prompt: "QUESTION_TWO", create: true });
  assert.equal(result.status, "completed");
  assert.equal(result.text, "ROUTE2_OK");
  assert.equal(result.attempts?.[0]?.transportModelAlias, "open_router/poolside/laguna-xs-2.1:free");
  assert.equal(result.attempts?.[0]?.outcome, "failed");
  assert.match(await readFile(marker, "utf8"), /north-mini-code/);
});

test("a failed route that left an assistant tool call is still never replayed", async () => {
  process.env.FAKE_MODE = "assistant_tool";
  await rm(marker, { force: true });
  const result = await runClaudeCodeTurn({ session: session("33333333-3333-4333-8333-333333333333"), prompt: "QUESTION_THREE", create: true });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /retry suppressed because the persistent Claude Code session changed/);
  await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });
});

test("a failed route whose only assistant entry is error TEXT (no tool) also reroutes", async () => {
  process.env.FAKE_MODE = "api_error_text";
  await rm(marker, { force: true });
  const result = await runClaudeCodeTurn({ session: session("44444444-4444-4444-8444-444444444444"), prompt: "QUESTION_FOUR", create: true });
  assert.equal(result.status, "completed");
  assert.equal(result.text, "ROUTE2_OK");
});
