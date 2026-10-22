import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { COCKPIT_AGENT_TARGETS, getCockpitAgentTarget } from "../src/lib/cockpit/agent-registry";
import { getCockpitRoutePresentation, LOCAL_ROUTE_PRESENTATION_CONTRACT } from "../src/lib/cockpit-route-presentation";

process.env.DATABASE_URL = "";

test("cockpit agent discovery has six unique current NORMAL session targets", () => {
  assert.equal(COCKPIT_AGENT_TARGETS.length, 6);
  assert.equal(new Set(COCKPIT_AGENT_TARGETS.map((target) => target.id)).size, 6);
  assert.equal(new Set(COCKPIT_AGENT_TARGETS.map((target) => target.apiAgentId)).size, 6);
  for (const target of COCKPIT_AGENT_TARGETS) {
    assert.match(target.actionEndpoint, /^\/api\/connectors\/.+\/actions\/ask$/);
    assert.match(target.sessionEndpoint, /^\/api\/connectors\/.+\/session$/);
    assert.ok(getCockpitAgentTarget(target.id));
    assert.equal(getCockpitRoutePresentation(target).routeType, "NORMAL");
  }
  assert.equal(getCockpitAgentTarget("claude-fcc")?.id, "claude-code");
  assert.equal(getCockpitAgentTarget("agy")?.id, "antigravity");
  assert.equal(COCKPIT_AGENT_TARGETS.some((target) => /local|ollama/i.test(target.id) || /local|ollama/i.test(target.label)), false);
});

test("normal/local presentation is explicit without registering an uncertified LOCAL agent", async () => {
  const certified = new Set(["claude-code", "hermes", "openclaw", "antigravity"]);
  for (const target of COCKPIT_AGENT_TARGETS) {
    const route = getCockpitRoutePresentation(target);
    assert.equal(route.routeType, "NORMAL");
    assert.equal(route.configuredProvider, null);
    assert.equal(route.configuredModel, null);
    assert.equal(route.routeStatus, certified.has(target.id) ? "CERTIFIED" : "CONFIGURED");
  }

  assert.equal(LOCAL_ROUTE_PRESENTATION_CONTRACT.routeType, "LOCAL");
  assert.equal(LOCAL_ROUTE_PRESENTATION_CONTRACT.registrationStatus, "BLOCKED");
  assert.equal(LOCAL_ROUTE_PRESENTATION_CONTRACT.ollamaRole, "MODEL_PROVIDER_NOT_AGENT");
  assert.deepEqual(
    [...LOCAL_ROUTE_PRESENTATION_CONTRACT.requiredVisibleFields],
    ["AGENT", "ROUTE_TYPE", "RUNTIME", "PROVIDER", "MODEL", "ROUTE_STATUS"]
  );

  const [workspaceSource, panelSource, sidebarSource] = await Promise.all([
    readFile("src/components/control-room/TerminalWorkspace.tsx", "utf8"),
    readFile("src/components/control-room/AgentConversationPanel.tsx", "utf8"),
    readFile("src/components/shell/Sidebar.tsx", "utf8"),
  ]);
  const defaultBindings = workspaceSource.match(/const DEFAULT_BINDINGS: PaneBinding\[\] = \[[\s\S]*?\n\];/)?.[0] ?? "";
  assert.equal((defaultBindings.match(/targetId:/g) ?? []).length, 4);
  assert.match(workspaceSource, /bindings\.map/);
  assert.match(workspaceSource, /targetId=\{target\.id\}/);
  assert.match(workspaceSource, /route\.routeType/);
  assert.match(workspaceSource, /route\.routeStatus/);
  assert.match(panelSource, /AGENT/);
  assert.match(panelSource, /ROUTE_TYPE/);
  assert.match(panelSource, /RUNTIME/);
  assert.match(panelSource, /PROVIDER/);
  assert.match(panelSource, /MODEL/);
  assert.match(panelSource, /ROUTE_STATUS/);
  assert.match(sidebarSource, /routePresentation\.routeType/);
  assert.match(sidebarSource, /routePresentation\.routeStatus/);
});

test("CLI session store keeps two sessions of the same agent independent", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-cockpit-cli-"));
  process.env.CLI_AGENT_SESSION_DATA_DIR = temp;
  process.env.MISSION_CONTROL_AGENT_WORKSPACE = process.cwd();
  const store = await import("../src/lib/cli-agents/session-store");
  await store.createCliAgentSession("codex", "pane-proof-a");
  await store.createCliAgentSession("codex", "pane-proof-b");
  await store.stopCliAgentSession("codex", "pane-proof-a");
  const sessions = await store.listCliAgentSessions("codex");
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find((session) => session.sessionKey === "pane-proof-a")?.active, false);
  assert.equal(sessions.find((session) => session.sessionKey === "pane-proof-b")?.active, true);
});

test("Claude session store discovers multiple independent session keys", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-cockpit-claude-"));
  process.env.CLAUDE_CODE_SESSION_DATA_DIR = temp;
  const store = await import("../src/lib/claude-code/session-store");
  const first = await store.createClaudeCodeSession("pane-proof-a");
  const second = await store.createClaudeCodeSession("pane-proof-b");
  const sessions = await store.listClaudeCodeSessions();
  assert.equal(sessions.length, 2);
  assert.notEqual(first.claudeSessionId, second.claudeSessionId);
  assert.deepEqual(new Set(sessions.map((session) => session.sessionKey)), new Set(["pane-proof-a", "pane-proof-b"]));
});
