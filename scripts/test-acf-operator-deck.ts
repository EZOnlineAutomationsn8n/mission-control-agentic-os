/**
 * ACF-OPERATOR-CONTROL-DECK-REALWORLD-001: Mission Control's Team Room control adapter for the operator deck.
 *
 * Part A: argument building and validation with a recording runner (no ACF).
 * Part B: the REAL ./acf CLI on a temporary RECORD_ONLY home (never state/team-room), through the adapter exactly as
 *         the control route calls it. Participants are a loopback stand-in in the shapes of Mission Control's
 *         ask/session routes with scripted replies: this proves what Mission Control + ACF do, nothing about a real agent.
 *
 * Run: ACF_TEST_PROJECT_ROOT=<acf tree> npx tsx --test scripts/test-acf-operator-deck.ts
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ACF_ROOT = process.env.ACF_TEST_PROJECT_ROOT || process.env.ACF_PROJECT_ROOT || "/workspace/projects/agentic-collaboration-fabric";
const HOME = mkdtempSync(path.join(tmpdir(), "acf-deck-home-"));
const ROUTES = path.join(HOME, "participant_routes.json");
process.env.ACF_PROJECT_ROOT = ACF_ROOT;
process.env.ACF_STATE_DIR = HOME;
process.env.ACF_TEAM_ROOM_ROUTES = ROUTES;
process.env.PYTHONDONTWRITEBYTECODE = "1";

type Adapter = typeof import("../src/lib/acf/control-adapter");
let A: Adapter;

// ------------------------------------------------------------------------------------------- stand-in participants
const CRITERION = "The checklist names the rollback step";
const CURRENT = /CURRENT_MESSAGE\n {2}(M\d+) (\w+) from=(\S+) to=(\S+)/;
type Call = { method: string; path: string; session: string | null; prompt?: string };
const calls: Call[] = [];
const sessions = new Map<string, { status: string; active: boolean }>([
  ["openclaw/acf-deck-openclaw", { status: "idle", active: true }],
  ["claude-code/acf-deck-claude", { status: "idle", active: true }],
  ["openclaw/mission-control-openclaw", { status: "idle", active: true }],
  ["claude-code/acf-deck-claude-spare", { status: "idle", active: true }],
]);

function reply(agent: string, prompt: string): string {
  const current = CURRENT.exec(prompt);
  if (current && current[3] === "OPERATOR" && current[1] !== "M1") {      // M1 is the run's seed (the objective), not an intervention
    return `${agent} answers the operator about ${current[1]}: the rollback step stays last.`;
  }
  const slot = /<<<ACF_REPLY:(\w+)/.exec(prompt)?.[1] ?? "x";
  if (agent !== "claude-code") {
    return `<<<ACF_REPLY:${slot}\nKIND=QUESTION\nTO=reviewer\nACF_REPLY_END>>>\n1. Rename the key.\n2. ${CRITERION}.\n3. Remove the old key.`;
  }
  const target = /Revision under review: (M\d+)/.exec(prompt)?.[1] ?? "M0";
  return `REVIEWED: ${target}\nCRITERION C1: MET\nCRITERION C2: MET\nEVIDENCE C2: "${CRITERION}"\nVERDICT: ACCEPT - evidence above`;
}

let server: Server;
let base = "";

function startStand(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stand");
    const agent = url.pathname.split("/")[3] ?? "";
    const send = (status: number, payload: unknown) => {
      const raw = JSON.stringify(payload);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(raw) });
      res.end(raw);
    };
    if (req.method === "GET") {
      const key = url.searchParams.get("sessionId") ?? "operator-default";
      calls.push({ method: "GET", path: url.pathname, session: key });
      const s = sessions.get(`${agent}/${key}`);
      return send(200, { session: s ? { sessionKey: key, active: s.active, status: s.status, lastError: null } : null });
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const data = JSON.parse(body) as { sessionId: string; prompt: string; initiator?: unknown };
      calls.push({ method: "POST", path: url.pathname, session: data.sessionId, prompt: data.prompt });
      const s = sessions.get(`${agent}/${data.sessionId}`);
      if (!s || !s.active || s.status !== "idle") return send(409, { error: "session is stopped or busy" });
      const n = calls.filter((c) => c.method === "POST").length;
      send(200, {
        id: `conv-${n}`, agentId: agent, sessionId: data.sessionId, status: "completed", text: reply(agent, data.prompt), error: null,
        agentSessionId: `rt-${agent}`, createdAt: "2026-10-14T16:00:00Z", completedAt: "2026-10-14T16:00:01Z",
        auditRecorded: true, auditError: null, ...(data.initiator ? { initiator: data.initiator, initiatorVerified: false } : {}),
      });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    resolve();
  }));
}

function writeRoutes() {
  const route = (agent: string) => ({
    enabled: true, initiator_contract: "acf-participant-dialogue", base_url: base,
    ask_path: `/api/connectors/${agent}/actions/ask`, session_path: `/api/connectors/${agent}/session`, timeout_seconds: 30,
  });
  writeFileSync(ROUTES, JSON.stringify({
    note: "test routes (loopback stand-in)", routes_version: 1, session_ref_pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$",
    routes: { openclaw: route("openclaw"), "claude-code": route("claude-code"), hermes: { enabled: false } },
  }, null, 1));
}

const lister = async () => [...sessions.entries()].map(([key, s], i) => {
  const [agentId, sessionId] = key.split("/");
  return { agentId, sessionId, status: s.status, active: s.active, executionMode: "on-demand-cli", lastError: null,
           updatedAt: `2026-10-14T1${i}:00:00.000Z`, workspace: "/secret/not/for/acf" };
});

test.before(async () => {
  await startStand();
  writeRoutes();
  A = await import("../src/lib/acf/control-adapter");
});
test.after(() => {
  server?.close();
  rmSync(HOME, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------- Part A: validation
function recorder(answers: Record<string, unknown> = {}) {
  const seen: Array<{ verb: string; args: Record<string, unknown> }> = [];
  const runner = async (argv: string[]) => {
    const verb = argv[0];
    const args = JSON.parse(argv[argv.indexOf("--args") + 1]) as Record<string, unknown>;
    seen.push({ verb, args });
    const answer = answers[verb];
    if (answer instanceof Error) throw answer;
    return JSON.stringify(answer ?? { ok: true, verb });
  };
  return { seen, runner };
}
const VIEW = { participants: [{ role: "builder", agent_id: "openclaw", session_ref: "s1" }, { role: "reviewer", agent_id: "claude-code", session_ref: "s2" }] };
const ENABLED = ["claude-code", "openclaw"];

test("A1 the browser never supplies the operator claim; ACF gets DENNIS", async () => {
  const r = recorder();
  await A.runAcfControl("team-intervene", { run_id: "RUN-1", reason: "check", by: "EVIL" }, r.runner, lister, ENABLED);
  assert.deepEqual(r.seen[0], { verb: "team-intervene", args: { run_id: "RUN-1", by: "DENNIS", reason: "check" } });
});

test("A2 a reason must be one line and at most 300 characters; nothing reaches ACF otherwise", async () => {
  const r = recorder();
  for (const reason of ["two\nlines", "x".repeat(301), "   "]) {
    const out = await A.runAcfControl("team-intervene", { run_id: "RUN-1", reason }, r.runner, lister, ENABLED);
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.code, "ARGUMENTS");
  }
  assert.equal(r.seen.length, 0);
});

test("A3 team-say checks the addressees against ACF's own team-view before writing", async () => {
  const r = recorder({ "team-view": VIEW, "team-say": { owed: [] } });
  const unknown = await A.runAcfControl("team-say", { run_id: "RUN-1", to: ["builder", "ghost"], text: "hi" }, r.runner, lister, ENABLED);
  assert.equal(!unknown.ok && unknown.code, "ROLE_UNBOUND");
  assert.deepEqual(r.seen.map((s) => s.verb), ["team-view"]);
  const ok = await A.runAcfControl("team-say", { run_id: "RUN-1", to: ["reviewer", "builder"], text: " hi ", kind: "NOTE", reply: false }, r.runner, lister, ENABLED);
  assert.equal(ok.ok, true);
  assert.deepEqual(r.seen.at(-1), { verb: "team-say", args: { run_id: "RUN-1", by: "DENNIS", to: ["reviewer", "builder"], text: "hi", kind: "NOTE", reply: false } });
});

test("A4 the orchestrator always gets a QUESTION with a reply; TEAM needs no role lookup", async () => {
  const r = recorder({ "team-say": { owed: [] } });
  await A.runAcfControl("team-say", { run_id: "RUN-1", to: "ORCHESTRATOR", text: "status?", kind: "NOTE", reply: false }, r.runner, lister, ENABLED);
  assert.deepEqual(r.seen.at(-1)?.args, { run_id: "RUN-1", by: "DENNIS", to: "ORCHESTRATOR", text: "status?", kind: "QUESTION", reply: true });
  await A.runAcfControl("team-say", { run_id: "RUN-1", to: "TEAM", text: "all" }, r.runner, lister, ENABLED);
  assert.deepEqual(r.seen.map((s) => s.verb), ["team-say", "team-say"]);
});

test("A5 text limits, kinds and malformed targets are refused before ACF", async () => {
  const r = recorder({ "team-view": VIEW });
  const cases: Array<Record<string, unknown>> = [
    { to: "builder", text: "" }, { to: "builder", text: "x".repeat(6001) }, { to: "builder", text: "a", kind: "ANSWER" },
    { to: "builder", text: "a", reply: "yes" }, { to: [], text: "a" }, { to: ["builder", "builder"], text: "a" }, { to: 5, text: "a" },
  ];
  for (const c of cases) {
    const out = await A.runAcfControl("team-say", { run_id: "RUN-1", ...c }, r.runner, lister, ENABLED);
    assert.equal(!out.ok && out.code, "ARGUMENTS", JSON.stringify(c).slice(0, 80));
  }
  assert.equal(r.seen.length, 0);
});

test("A6 team-open takes its bindings from team-sessions and never from the browser", async () => {
  const sessionsAnswer = { ready: true, bindings: { builder: { agent_id: "openclaw", session_ref: "acf-x" }, reviewer: { agent_id: "claude-code", session_ref: "acf-y" } } };
  const r = recorder({ "team-sessions": sessionsAnswer, "team-open": { run_id: "RUN-NEW" } });
  const out = await A.runAcfControl("team-open", { objective: "Goal", success_criterion: "Crit", bindings: { builder: { agent_id: "openclaw", session_ref: "mission-control-openclaw" } } },
    r.runner, lister, ENABLED);
  assert.equal(out.ok, true);
  const [sel, open] = r.seen;
  assert.equal(sel.verb, "team-sessions");
  assert.deepEqual(sel.args.roles, { builder: "openclaw", reviewer: "claude-code" });
  assert.equal((sel.args.candidates as Array<Record<string, unknown>>).every((c) => !("workspace" in c)), true, "only the fields ACF classifies on");
  assert.deepEqual((open.args as { bindings: unknown }).bindings, sessionsAnswer.bindings);
  assert.equal((open.args as { created_by: unknown }).created_by, "DENNIS");
});

test("A7 team-open writes nothing when a role has no ready session, and returns ACF's reasons", async () => {
  const notReady = { ready: false, bindings: { builder: null, reviewer: { agent_id: "claude-code", session_ref: "acf-y" } }, roles: { builder: { why_none: "NO_ELIGIBLE_ACF_SESSION" } } };
  const r = recorder({ "team-sessions": notReady });
  const out = await A.runAcfControl("team-open", { objective: "Goal", success_criterion: "Crit" }, r.runner, lister, ENABLED);
  assert.equal(!out.ok && out.code, "TEAM_SESSIONS_NOT_READY");
  assert.deepEqual(!out.ok && out.sessions, notReady);
  assert.deepEqual(r.seen.map((s) => s.verb), ["team-sessions"]);
});

test("A8 roles must use enabled routes and different agents; pins must be session names of asked roles", async () => {
  const r = recorder();
  for (const bad of [{ roles: { builder: "hermes" } }, { roles: { builder: "claude-code" } }, { pins: { judge: "acf-z" } }, { pins: { builder: "../x" } }]) {
    const out = await A.teamSessions(bad, r.runner, lister, ENABLED);
    assert.equal(!out.ok && out.code, "ARGUMENTS", JSON.stringify(bad));
  }
  assert.equal(r.seen.length, 0);
});

test("A9 team-continue makes a fresh successor id; the predecessor is only referenced", async () => {
  const r = recorder({ "team-continue": { run_id: "X" } });
  await A.runAcfControl("team-continue", { run_id: "RUN-OLD", instruction: "add tests" }, r.runner, lister, ENABLED);
  const args = r.seen[0].args;
  assert.equal(args.predecessor_run_id, "RUN-OLD");
  assert.match(String(args.run_id), /^RUN-TR-\d{8}-\d{6}-[0-9A-F]{4}$/);
  assert.equal(args.created_by, "DENNIS");
});

test("A10 rebind and resume arguments", async () => {
  const r = recorder();
  assert.equal((await A.runAcfControl("team-rebind", { run_id: "R", role: "builder", session_ref: "a b" }, r.runner, lister, ENABLED) as { code?: string }).code, "ARGUMENTS");
  assert.equal((await A.runAcfControl("team-rebind", { run_id: "R", role: "builder", session_ref: "acf-x", agent_id: "hermes" }, r.runner, lister, ENABLED) as { code?: string }).code, "ARGUMENTS");
  await A.runAcfControl("team-rebind", { run_id: "R", role: "builder", session_ref: "acf-x", agent_id: "openclaw" }, r.runner, lister, ENABLED);
  await A.runAcfControl("team-resume", { run_id: "R" }, r.runner, lister, ENABLED);
  assert.deepEqual(r.seen.map((s) => s.args), [
    { run_id: "R", by: "DENNIS", role: "builder", session_ref: "acf-x", agent_id: "openclaw" },
    { run_id: "R", by: "DENNIS", abandon_owed_replies: false },
  ]);
});

test("A11 unknown verbs and ACF refusals keep ACF's own code", async () => {
  const r = recorder();
  assert.equal((await A.runAcfControl("team-cancel", {}, r.runner) as { code?: string }).code, "ARGUMENTS");
  const refusing = async () => { throw Object.assign(new Error("exit 2"), { stdout: JSON.stringify({ error: "NO_OPEN_INTERVENTION", detail: "team-intervene first" }) }); };
  const out = await A.runAcfControl("team-say", { run_id: "R", to: "TEAM", text: "x" }, refusing, lister, ENABLED);
  assert.deepEqual(out, { ok: false, verb: "team-say", code: "NO_OPEN_INTERVENTION", detail: "team-intervene first" });
});

// ------------------------------------------------------------------------------------------- Part B: real ACF CLI
const haveAcf = existsSync(path.join(ACF_ROOT, "acf"));

async function view(runId: string) {
  const { execFileSync } = await import("node:child_process");
  return JSON.parse(execFileSync(path.join(ACF_ROOT, "acf"), ["team-view", "--state-dir", HOME, "--args", JSON.stringify({ run_id: runId })],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function step(runId: string) {
  const out = await A.runAcfControl("team-step", { run_id: runId }, undefined, lister);
  assert.equal(out.ok, true, JSON.stringify(out));
  return (out as { result: Record<string, unknown> }).result;
}

test("B the deck's full path on the real ACF CLI: open, autonomous turn, intervene, ask, guide, orchestrator, resume, continue", { skip: !haveAcf }, async () => {
  const posts = () => calls.filter((c) => c.method === "POST");

  // session selection: an individual pane is never taken unpinned; the acf- sessions are chosen and asked live
  const chosen = await A.teamSessions({}, undefined, lister);
  assert.equal(chosen.ok, true, JSON.stringify(chosen));
  const answer = (chosen as { answer: Record<string, any> }).answer; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(answer.ready, true);
  assert.deepEqual(answer.bindings.builder, { agent_id: "openclaw", session_ref: "acf-deck-openclaw" });
  const builderRows = Object.fromEntries(answer.roles.builder.candidates.map((c: { session_ref: string; verdict: string }) => [c.session_ref, c.verdict]));
  assert.equal(builderRows["mission-control-openclaw"], "ELIGIBLE_PIN_REQUIRED");
  assert.equal(posts().length, 0, "selection sends no prompt");

  const opened = await A.runAcfControl("team-open", { objective: "A checklist for renaming a configuration key", success_criterion: CRITERION }, undefined, lister);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const runId = String((opened as { result: Record<string, unknown> }).result.run_id);
  let v = await view(runId);
  assert.equal(v.autonomy, "AUTONOMOUS");

  // one autonomous turn (builder)
  assert.equal((await step(runId)).kind, "TURN");
  assert.equal(posts().length, 1);

  // intervene: the team pauses; drafting never did this, only this explicit verb
  const paused = await A.runAcfControl("team-intervene", { run_id: runId, reason: "check the rollback" });
  assert.equal(paused.ok, true, JSON.stringify(paused));
  v = await view(runId);
  assert.equal(v.autonomy, "OPERATOR_INTERVENTION");
  const iid = v.intervention.open.intervention_id;

  // an autonomous turn is now impossible: team-step makes only owed replies, and there are none
  const nothing = await A.runAcfControl("team-step", { run_id: runId });
  assert.equal(!nothing.ok && nothing.code, "INTERVENTION_NOTHING_OWED");

  // question to ONE agent -> one owed reply -> one directed turn in its real (stand-in) session
  const asked = await A.runAcfControl("team-say", { run_id: runId, to: "builder", text: "Why is the rollback step last?", kind: "QUESTION", reply: true });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  const qid = ((asked as unknown as { result: { messages: Array<{ message_id: string }> } }).result.messages)[0].message_id;
  const directed = await step(runId);
  assert.equal(directed.kind, "DIRECTED");
  const turn = directed.turn as Record<string, unknown>;
  assert.equal(turn.failed, false);
  assert.equal(posts().at(-1)?.session, "acf-deck-openclaw");
  assert.match(String(posts().at(-1)?.prompt), /from=OPERATOR/);

  // correlation as the deck renders it: directed_turns[].operator_message_id -> the reply message, with agent/session/conversation
  v = await view(runId);
  const reply = v.directed_turns.find((t: { operator_message_id: string }) => t.operator_message_id === qid);
  assert.equal(reply.outcome, "POSTED");
  assert.equal(reply.agent_id, "openclaw");
  assert.equal(reply.session_ref, "acf-deck-openclaw");
  assert.ok(reply.conversation_ref);
  assert.equal(reply.intervention_id, iid);
  assert.equal(v.intervention.open.messages[0].text, "Why is the rollback step last?");

  // SELECTED agents with guidance (no reply owed, no turn) and the orchestrator (deterministic answer, no prompt)
  const before = posts().length;
  const guided = await A.runAcfControl("team-say", { run_id: runId, to: ["reviewer", "builder"], text: "Keep it under ten steps.", kind: "NOTE", reply: false });
  assert.equal(guided.ok, true, JSON.stringify(guided));
  assert.deepEqual((guided as unknown as { result: { owed: unknown[] } }).result.owed, []);
  const orch = await A.runAcfControl("team-say", { run_id: runId, to: "ORCHESTRATOR", text: "Who speaks next?", kind: "NOTE", reply: false });
  assert.equal(orch.ok, true, JSON.stringify(orch));
  await step(runId);
  assert.equal(posts().length, before, "guidance and the orchestrator's answer send no participant prompt");
  v = await view(runId);
  assert.equal(v.intervention.open.owed.length, 0);
  assert.equal(v.intervention.open.orchestrator_answers.length, 1);

  // TEAM question then resume with one reply still owed: refused unless explicitly abandoned
  await A.runAcfControl("team-say", { run_id: runId, to: "TEAM", text: "Any risk left?", kind: "QUESTION", reply: true });
  await step(runId);                               // builder answers; reviewer still owed
  const refused = await A.runAcfControl("team-resume", { run_id: runId });
  assert.equal(!refused.ok && refused.code, "INTERVENTION_REPLIES_OWED");
  const resumed = await A.runAcfControl("team-resume", { run_id: runId, abandon_owed_replies: true });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  v = await view(runId);
  assert.equal(v.autonomy, "AUTONOMOUS");
  assert.equal(v.intervention.history.length, 1);

  // the loop continues autonomously to its evidenced stop
  const resumedStep = await step(runId);
  assert.equal(resumedStep.kind, "TURN", JSON.stringify({ step: resumedStep, loop: v.loop, nsa: v.next_safe_action }).slice(0, 3000));   // reviewer accepts with evidence
  v = await view(runId);
  assert.equal(v.loop.status, "STOPPED_ACCEPTED");
  assert.ok(String(v.next_safe_action).includes("TEAM_CONTINUE"));

  // linked continuation: a new run; the predecessor is untouched
  const hashBefore = v.state_hash;
  const next = await A.runAcfControl("team-continue", { run_id: runId, instruction: "Add a verification step." });
  assert.equal(next.ok, true, JSON.stringify(next));
  const successor = String((next as { result: Record<string, unknown> }).result.run_id);
  assert.notEqual(successor, runId);
  const after = await view(runId);
  assert.equal(after.state_hash, hashBefore);
  assert.equal(after.lineage.successors[0].run_id, successor);
  const sv = await view(successor);
  assert.equal(sv.lineage.predecessor.run_id, runId);
  assert.equal(sv.autonomy, "AUTONOMOUS");
});

test("B2 held sessions are excluded; rebind works only inside an intervention; a busy session refuses the step", { skip: !haveAcf }, async () => {
  // test B's successor run still holds its sessions: ACF must refuse them and say why (nothing is created instead)
  const held = await A.runAcfControl("team-open", { objective: "Second room", success_criterion: CRITERION }, undefined, lister);
  assert.equal(!held.ok && held.code, "TEAM_SESSIONS_NOT_READY");
  const builderRows = (held as { sessions: Record<string, any> }).sessions.roles.builder.candidates; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(builderRows.find((c: { session_ref: string }) => c.session_ref === "acf-deck-openclaw").verdict, "EXCLUDED_IN_USE_BY_OPEN_RUN");

  sessions.set("openclaw/acf-deck-openclaw-2", { status: "idle", active: true });
  sessions.set("claude-code/acf-deck-claude-3", { status: "idle", active: true });
  sessions.set("claude-code/acf-deck-claude-4", { status: "idle", active: true });
  const opened = await A.runAcfControl("team-open", { objective: "Second room", success_criterion: CRITERION,
    pins: { builder: "acf-deck-openclaw-2", reviewer: "acf-deck-claude-3" } }, undefined, lister);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const runId = String((opened as { result: Record<string, unknown> }).result.run_id);
  let v = await view(runId);
  assert.equal(v.participants.find((p: { role: string }) => p.role === "reviewer").session_ref, "acf-deck-claude-3");
  const outside = await A.runAcfControl("team-rebind", { run_id: runId, role: "reviewer", session_ref: "acf-deck-claude-4" });
  assert.equal(outside.ok, false, "rebind outside an intervention is refused");
  await A.runAcfControl("team-intervene", { run_id: runId, reason: "move the reviewer" });
  const moved = await A.runAcfControl("team-rebind", { run_id: runId, role: "reviewer", session_ref: "acf-deck-claude-4" });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  v = await view(runId);
  assert.equal(v.participants.find((p: { role: string }) => p.role === "reviewer").session_ref, "acf-deck-claude-4");

  const posted = calls.filter((c) => c.method === "POST").length;
  sessions.set("openclaw/acf-deck-openclaw-2", { status: "running", active: true });
  await A.runAcfControl("team-say", { run_id: runId, to: "builder", text: "Are you there?" });
  const busy = await A.runAcfControl("team-step", { run_id: runId });
  assert.equal(!busy.ok && busy.code, "TEAM_SESSION_NOT_READY", "a busy session refuses the step");
  assert.equal(calls.filter((c) => c.method === "POST").length, posted, "nothing was sent");
  sessions.set("openclaw/acf-deck-openclaw-2", { status: "idle", active: true });
  assert.equal((await step(runId)).kind, "DIRECTED", "the same owed reply is made once the session is idle again");
});
