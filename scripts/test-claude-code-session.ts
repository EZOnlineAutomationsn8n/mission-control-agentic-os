import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = await mkdtemp(path.join(process.cwd(), ".test-claude-code-session-"));
const workspace = path.join(root, "workspace");
const launcher = path.join(root, "fake-claude-code.mjs");
await mkdir(workspace, { recursive: true });
await writeFile(path.join(workspace, "CLAUDE.md"), "# Test Claude instructions\n", "utf8");
await writeFile(launcher, `#!/usr/bin/env node
const args = process.argv.slice(2);
const idFlag = args.indexOf("--session-id");
const resumeFlag = args.indexOf("--resume");
const sessionId = args[idFlag >= 0 ? idFlag + 1 : resumeFlag + 1];
const providerFailure = args.at(-1) === "force provider failure";
const bootstrapFailure = process.env.TEST_CLAUDE_BOOTSTRAP_FAILURE === "1" && args.at(-1).startsWith("Initialize this Mission Control");
const model = args[args.indexOf("--model") + 1];
const firstRouteFailure = args.at(-1) === "fallback after provider failure" && model.includes("laguna-m.1");
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: providerFailure || firstRouteFailure || bootstrapFailure,
  result: providerFailure || firstRouteFailure || bootstrapFailure ? "Provider API request failed. (request_id=test)" : "FAKE_CLAUDE_CODE cwd=" + process.cwd() + " bare=" + process.env.CLAUDE_BARE + " model=" + model,
  session_id: sessionId,
  modelUsage: { "fcc-gateway-alias": {} },
  permission_denials: []
}));
`, "utf8");
await chmod(launcher, 0o755);

process.env.CLAUDE_CODE_LAUNCHER = launcher;
process.env.CLAUDE_CODE_SKIP_ROUTE_PREFLIGHT = "1";
process.env.CLAUDE_CODE_WORKSPACE = workspace;
process.env.CLAUDE_CODE_SESSION_DATA_DIR = root;
process.env.AGENT_CONVERSATION_DATA_DIR = root;
process.env.AUDIT_DATA_DIR = root;

const sessionRoute = await import("../src/app/api/connectors/claude-code/session/route");
const askRoute = await import("../src/app/api/connectors/claude-code/actions/ask/route");
const { readConversation } = await import("../src/lib/agent-conversations/store");
const { readAuditEvents } = await import("../src/lib/audit-log-store");

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("real-agent bridge lifecycle is explicit, persisted, and audited", async () => {
  const url = "http://local/api/connectors/claude-code/session?sessionId=test-session";
  const before = await sessionRoute.GET(new Request(url));
  assert.equal((await before.json()).session, null);

  const startedResponse = await sessionRoute.POST(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  }));
  assert.equal(startedResponse.status, 200);
  const started = await startedResponse.json();
  assert.equal(started.session.active, true);
  assert.equal(started.session.status, "idle");
  assert.equal(started.session.workspace, workspace);
  assert.equal(started.agentIdentity, "Claude Code");
  assert.match(started.bootstrap, /FAKE_CLAUDE_CODE/);
  assert.equal(started.gatewayModelAlias, "fcc-gateway-alias");

  const turnResponse = await askRoute.POST(new Request("http://local/api/connectors/claude-code/actions/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "test-session", prompt: "work on the repository" }),
  }));
  assert.equal(turnResponse.status, 200);
  const turn = await turnResponse.json();
  assert.equal(turn.agentIdentity, "Claude Code");
  assert.equal(turn.agentSessionId, started.session.claudeSessionId);
  assert.equal(turn.workspace, workspace);
  assert.equal(turn.transportModelAlias, "fcc-gateway-alias");
  assert.equal(turn.actualRuntimeModel, null);
  assert.match(turn.text, /bare=0/);
  assert.match(turn.text, /poolside\/laguna-m\.1/);

  const fallbackResponse = await askRoute.POST(new Request("http://local/api/connectors/claude-code/actions/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "test-session", prompt: "fallback after provider failure" }),
  }));
  assert.equal(fallbackResponse.status, 200);
  const fallbackTurn = await fallbackResponse.json();
  assert.equal(fallbackTurn.status, "completed");
  assert.match(fallbackTurn.text, /qwen\/qwen3-coder:free/);
  assert.equal(fallbackTurn.attempts[0].transportModelAlias, "open_router/poolside/laguna-m.1:free");
  assert.equal(fallbackTurn.attempts[0].outcome, "upstream_provider_failed");
  assert.equal(fallbackTurn.attempts[1].transportModelAlias, "open_router/qwen/qwen3-coder:free");
  assert.equal(fallbackTurn.attempts[1].outcome, "completed");

  const persisted = await readConversation("claude-code", "test-session");
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].agentSessionId, started.session.claudeSessionId);

  const failedTurnResponse = await askRoute.POST(new Request("http://local/api/connectors/claude-code/actions/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "test-session", prompt: "force provider failure" }),
  }));
  assert.equal(failedTurnResponse.status, 200);
  const failedTurn = await failedTurnResponse.json();
  assert.equal(failedTurn.status, "failed");
  assert.equal(failedTurn.text, null);
  assert.match(failedTurn.error, /Provider API request failed/);
  assert.equal(failedTurn.transportModelAlias, "open_router/openrouter/free");

  const stoppedResponse = await sessionRoute.POST(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "stop" }),
  }));
  assert.equal(stoppedResponse.status, 200);
  const stopped = await stoppedResponse.json();
  assert.equal(stopped.session.active, false);
  assert.equal(stopped.session.status, "stopped");

  const audits = await readAuditEvents();
  assert.equal(audits.some((event) => event.actionType === "claude-code-session-start"), true);
  assert.equal(audits.some((event) => event.actionType === "claude-code-agent-turn"), true);
  assert.equal(audits.some((event) => event.actionType === "claude-code-session-stop"), true);

  process.env.TEST_CLAUDE_BOOTSTRAP_FAILURE = "1";
  const failedStartUrl = "http://local/api/connectors/claude-code/session?sessionId=failed-bootstrap";
  const failedStartResponse = await sessionRoute.POST(new Request(failedStartUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  }));
  delete process.env.TEST_CLAUDE_BOOTSTRAP_FAILURE;
  assert.equal(failedStartResponse.status, 502);
  const failedStart = await failedStartResponse.json();
  assert.equal(failedStart.session.active, false);
  assert.equal(failedStart.session.status, "error");
  assert.match(failedStart.error, /all available Claude Code agent routes failed/);
});
