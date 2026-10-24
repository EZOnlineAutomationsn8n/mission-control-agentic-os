/**
 * ACF Team Room operator controls (2026-10-12, Dennis: his working room runs without signing keys).
 *
 * Mission Control runs the existing, certified ACF verbs on the Team Room home (state/team-room in the ACF project).
 * That home is RECORD_ONLY: ACF records "DENNIS" as the operator claim, no key, no assertion. ACF itself still decides
 * everything: who speaks next, the evidence gate, when the loop stops, what an intervention may do.
 *
 * 2026-10-14 (ACF-OPERATOR-CONTROL-DECK-REALWORLD-001): the operator deck adds the intervention, session-selection and
 * continuation verbs of contracts/ACF_TEAM_ROOM_CONTROL_V1.md §8-§11 (handoff ACF_TEAM_ROOM_MC_INTERVENTION_HANDOFF_V1
 * R1-R8). The browser never supplies `by` / `created_by` / bindings: they are filled here, bindings from team-sessions.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ACF_PROJECT_ROOT = process.env.ACF_PROJECT_ROOT || "/workspace/projects/agentic-collaboration-fabric";
export const ACF_TEAM_ROOM_HOME = process.env.ACF_STATE_DIR || `${ACF_PROJECT_ROOT}/state/team-room`;
export const ACF_TEAM_ROOM_ROUTES = process.env.ACF_TEAM_ROOM_ROUTES || `${ACF_TEAM_ROOM_HOME}/participant_routes.json`;
export const ACF_TEAM_CONTROL_VERBS = [
  "team-open", "team-open-participants", "team-task", "team-join", "team-step", "team-reconcile",
  "team-intervene", "team-say", "team-collaborate", "team-resume", "team-stop",
  "team-reconcile-late", "team-consensus-propose", "team-rebind", "team-continue",
] as const;
export type AcfControlVerb = (typeof ACF_TEAM_CONTROL_VERBS)[number];

export type AcfControlResult =
  | { ok: true; verb: AcfControlVerb; result: Record<string, unknown> }
  | { ok: false; verb: AcfControlVerb | null; code: string; detail: string; sessions?: Record<string, unknown> };

const OPERATOR = "DENNIS";
const STEP_TIMEOUT_MS = 330_000;   // one participant turn may take up to 270 s (route timeout) plus ACF's own work
const OTHER_TIMEOUT_MS = 60_000;
const OPEN_TIMEOUT_MS = 90_000;    // team-open / team-continue ask every bound session live first

/** ACF limits (runtime/acf_runtime/team_room.py), checked here first so the operator gets words, not a stack. */
export const LIMITS = { reason: 300, say: 6000, instruction: 3000, objective: 4000, criterion: 400 } as const;

/** Default agents per role when the operator does not choose (Dennis D3: OpenClaw builds, Claude Code reviews). */
export const TEAM_ROOM_DEFAULT_ROLES: Record<string, string> = { builder: "openclaw", reviewer: "claude-code" };
export const TEAM_ROOM_ROLE_NAMES = ["builder", "reviewer"] as const;

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const ROLE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const AGENT_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SESSION_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;   // mission-control isValidConversationKey (= ACF routes pattern)
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// D8: a participant slot is an independent agent/session, not a fixed job seat.
// Roles below are optional *function tags*, not ACF core role identities.
const D8_HANDLE_RE = /^[a-z][a-z0-9-]{0,30}$/;
const D8_TASK_RE = /^T[1-9][0-9]{0,3}$/;
const D8_FUNCTION_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export interface D8Participant {
  handle: string; agent_id: string; session_ref: string; roles?: string[];
}

export function validateD8Participants(value: unknown, enabled: string[]): D8Participant[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const seen = new Set<string>(); const handles = new Set<string>();
  const checked: D8Participant[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.handle !== "string" || !D8_HANDLE_RE.test(p.handle) || handles.has(p.handle)) return null;
    if (typeof p.agent_id !== "string" || !AGENT_RE.test(p.agent_id) || !enabled.includes(p.agent_id)) return null;
    if (typeof p.session_ref !== "string" || !SESSION_RE.test(p.session_ref)) return null;
    const key = JSON.stringify([p.agent_id, p.session_ref]);
    if (seen.has(key)) return null;
    if (p.roles !== undefined && (!Array.isArray(p.roles) || p.roles.length > 8
      || p.roles.some(r => typeof r !== "string" || !D8_FUNCTION_RE.test(r))
      || new Set(p.roles).size !== p.roles.length)) return null;
    handles.add(p.handle); seen.add(key);
    checked.push({ handle: p.handle, agent_id: p.agent_id, session_ref: p.session_ref,
      ...(p.roles === undefined ? {} : { roles: p.roles as string[] }) });
  }
  return checked;
}

export function buildD8OpenSpec(goal: string, participants: D8Participant[], successCriterion: string, runId = newRunId()) {
  return {
    run_id: runId, ...(goal.trim() ? { goal: goal.trim() } : {}), project: "ACF", created_by: OPERATOR,
    participants, routes_file: ACF_TEAM_ROOM_ROUTES,
    // Schema-2 FREE rooms use durable C<n> work windows; never set a
    // misleading lifetime cap from the browser (ACF owns bounded task/v1 rules).
    ...(successCriterion.trim() ? { success_criteria: [oneLine(successCriterion, LIMITS.criterion)] } : {}),
  };
}

async function requireExistingMcSessions(participants: D8Participant[], lister: SessionLister): Promise<string | null> {
  let rows: Array<Record<string, unknown>>;
  try { rows = await lister(); } catch { return "Mission Control session index unavailable"; }
  for (const participant of participants) {
    const match = rows.find(row => row.agentId === participant.agent_id && row.sessionId === participant.session_ref);
    if (!match) return `Unknown session ${participant.agent_id}/${participant.session_ref}; create/restore it in its owning registry first`;
  }
  return null;
}

async function requireV2Run(runId: string, runner: AcfRunner): Promise<
  { ok: true; participants: Array<{ role: string; agent_id: string; session_ref: string }> }
  | { ok: false; code: string; detail: string }
> {
  const raw = await callAcf("team-view", { run_id: runId }, OTHER_TIMEOUT_MS, runner);
  if (!raw.ok) return raw;
  if (raw.answer.schema !== 2) return { ok: false, code: "D8_SCHEMA_REQUIRED", detail: "D8 controls require an acf.schema:2 run; historical v1 runs remain on their existing controls" };
  const members = Array.isArray(raw.answer.participants) ? raw.answer.participants : [];
  return { ok: true, participants: members.filter(x => x && typeof x === "object")
    .map(x => x as { role: string; agent_id: string; session_ref: string }) };
}


function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function hasControlChars(text: string): boolean {
  return CONTROL_CHARS.test(text);
}

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `RUN-TR-${stamp}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export type TeamBinding = { agent_id: string; session_ref: string };

/** The team-open spec for one objective: builder/reviewer loop, evidence-gated by ACF's review contract v2.
 *  Bindings come from team-sessions (handoff R6); this function never invents a session. */
export function buildTeamOpenSpec(objective: string, successCriterion: string, bindings: Record<string, TeamBinding>,
                                  runId = newRunId()) {
  const goal = objective.trim();
  const criterion = oneLine(successCriterion, LIMITS.criterion);
  return {
    run_id: runId,
    goal,
    project: "ACF",
    success_criteria: [criterion],
    created_by: OPERATOR,
    roles: [
      { name: "builder", capability_tags: ["acf.loop:builder"] },
      {
        name: "reviewer",
        capability_tags: [
          "acf.loop:reviewer",
          "acf.loop:max_reviews:3",
          "acf.review:contract:2",
          "acf.review:criterion:C1:MAX_WORDS:1500",
          `acf.review:criterion:C2:QUOTE:${criterion}`,
        ],
      },
    ],
    bindings: { builder: bindings.builder, reviewer: bindings.reviewer },
    seed: { to: "builder", text: `${goal}\n\nSuccess criterion: ${criterion}` },
    routes_file: ACF_TEAM_ROOM_ROUTES,
    max_turns: 6,
  };
}

export type AcfRunner = (args: string[], timeoutMs: number) => Promise<string>;

/** Rows of Mission Control's own session index (/api/cockpit/sessions shape), the team-sessions candidates. */
export type SessionLister = () => Promise<Array<Record<string, unknown>>>;

const defaultRunner: AcfRunner = async (args, timeoutMs) => {
  const { stdout } = await execFileAsync("./acf", args, {
    cwd: ACF_PROJECT_ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
  });
  return String(stdout);
};

/**
 * Stage roster has a single canonical owner: its own existing session registry.
 * A live session index is never acceptable as stage readiness evidence,
 * even when a production-owned key begins with "acf-werkplaats-".
 */
export function reconcileStageCliCandidates(
  _liveReadOnly: Array<Record<string, unknown>>,
  stage: Array<Record<string, unknown>>,
  pattern: string,
): Array<Record<string, unknown>> {
  const re = new RegExp(pattern);
  return stage.filter(item => re.test(String(item.sessionId ?? "")));
}

const defaultLister: SessionLister = async () => {
  const { listCockpitSessions } = await import("@/lib/cockpit/session-registry");
  const sessions = (await listCockpitSessions()) as unknown as Array<Record<string, unknown>>;
  if (process.env.MC_PREVIEW !== "1") return sessions;
  // Never let an unavailable or malformed stage route file silently fall
  // back to a LIVE index or an unbounded personal-session list.
  try {
    const routes = JSON.parse(await readFile(ACF_TEAM_ROOM_ROUTES, "utf8")) as {
      session_ref_pattern?: string;
    };
    const pattern = routes.session_ref_pattern;
    if (typeof pattern !== "string" || !pattern.startsWith("^acf-werkplaats-")) return [];
    return reconcileStageCliCandidates([], sessions, pattern);
  } catch {
    return [];
  }
};

function parseAnswer(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ACF answer is not an object");
  return value as Record<string, unknown>;
}

type Raw = { ok: true; answer: Record<string, unknown> } | { ok: false; code: string; detail: string };

/** One ./acf call on the Team Room home: ACF's answer, or its refusal as {code, detail}. */
async function callAcf(verb: string, acfArgs: Record<string, unknown>, timeoutMs: number, runner: AcfRunner): Promise<Raw> {
  let raw: string;
  try {
    raw = await runner([verb, "--state-dir", ACF_TEAM_ROOM_HOME, "--args", JSON.stringify(acfArgs)], timeoutMs);
  } catch (error) {
    // ./acf exits non-zero with its refusal as JSON on stdout ({"error": CODE, "detail": ...})
    const stdout = (error as { stdout?: unknown })?.stdout;
    if (typeof stdout === "string" && stdout.trim()) {
      try {
        const refusal = parseAnswer(stdout);
        return { ok: false, code: String(refusal.error ?? "ACF_REFUSED"), detail: String(refusal.detail ?? "") };
      } catch { /* fall through */ }
    }
    return { ok: false, code: "ACF_UNAVAILABLE", detail: error instanceof Error ? error.message.slice(0, 500) : "ACF command failed" };
  }
  try {
    const answer = parseAnswer(raw);
    if (typeof answer.error === "string") return { ok: false, code: answer.error, detail: String(answer.detail ?? "") };
    return { ok: true, answer };
  } catch (error) {
    return { ok: false, code: "MALFORMED_ANSWER", detail: error instanceof Error ? error.message : "invalid JSON" };
  }
}

/** Agents with an enabled route in the Team Room routes file (data, not code: state/team-room/participant_routes.json). */
export async function enabledTeamRoomAgents(path = ACF_TEAM_ROOM_ROUTES): Promise<string[]> {
  try {
    const config = JSON.parse(await readFile(path, "utf8")) as { routes?: Record<string, { enabled?: unknown }> };
    return Object.entries(config.routes ?? {}).filter(([, entry]) => entry?.enabled === true).map(([id]) => id).sort();
  } catch {
    return [];
  }
}

function candidateRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    agentId: row.agentId, sessionId: row.sessionId, status: row.status, active: row.active,
    updatedAt: row.updatedAt, executionMode: row.executionMode, lastError: row.lastError ?? null,
  }));
}

/** Validate {role: agent} and {role: sessionId} pins from the browser against the enabled routes. */
function rolesAndPins(rolesIn: unknown, pinsIn: unknown, enabled: string[]):
  { ok: true; roles: Record<string, string>; pins: Record<string, string> } | { ok: false; detail: string } {
  const roles: Record<string, string> = { ...TEAM_ROOM_DEFAULT_ROLES };
  if (rolesIn !== undefined && rolesIn !== null) {
    if (typeof rolesIn !== "object" || Array.isArray(rolesIn)) return { ok: false, detail: "roles: {role: agent}" };
    for (const [role, agent] of Object.entries(rolesIn as Record<string, unknown>)) {
      if (!ROLE_RE.test(role) || typeof agent !== "string" || !AGENT_RE.test(agent)) return { ok: false, detail: `role ${role}` };
      roles[role] = agent;
    }
  }
  for (const [role, agent] of Object.entries(roles)) {
    if (!enabled.includes(agent)) return { ok: false, detail: `${role}: ${agent} has no enabled Team Room route (enabled: ${enabled.join(", ") || "none"})` };
  }
  if (new Set(Object.values(roles)).size !== Object.keys(roles).length) return { ok: false, detail: "each role needs a different agent" };
  const pins: Record<string, string> = {};
  if (pinsIn !== undefined && pinsIn !== null) {
    if (typeof pinsIn !== "object" || Array.isArray(pinsIn)) return { ok: false, detail: "pins: {role: sessionId}" };
    for (const [role, session] of Object.entries(pinsIn as Record<string, unknown>)) {
      if (session === "" || session === null) continue;
      if (!(role in roles) || typeof session !== "string" || !SESSION_RE.test(session)) return { ok: false, detail: `pin for ${role}` };
      pins[role] = session;
    }
  }
  return { ok: true, roles, pins };
}

/** team-sessions (read): which existing sessions may serve the roles. Nothing is started, stopped or created (R4, R7). */
export async function teamSessions(input: { roles?: unknown; pins?: unknown; excludeRun?: unknown },
                                   runner: AcfRunner = defaultRunner, lister: SessionLister = defaultLister,
                                   enabled?: string[]): Promise<
  { ok: true; answer: Record<string, unknown>; roles: Record<string, string>; enabled: string[] } | { ok: false; code: string; detail: string }> {
  const agents = enabled ?? await enabledTeamRoomAgents();
  const checked = rolesAndPins(input.roles, input.pins, agents);
  if (!checked.ok) return { ok: false, code: "ARGUMENTS", detail: checked.detail };
  let rows: Array<Record<string, unknown>>;
  try {
    rows = candidateRows(await lister());
  } catch (error) {
    return { ok: false, code: "SESSION_INDEX_UNAVAILABLE", detail: error instanceof Error ? error.message.slice(0, 300) : "session index failed" };
  }
  const args: Record<string, unknown> = { routes_file: ACF_TEAM_ROOM_ROUTES, roles: checked.roles, candidates: rows };
  if (Object.keys(checked.pins).length) args.pins = checked.pins;
  if (typeof input.excludeRun === "string" && RUN_ID_RE.test(input.excludeRun)) args.exclude_run = input.excludeRun;
  const raw = await callAcf("team-sessions", args, OTHER_TIMEOUT_MS, runner);
  if (!raw.ok) return raw;
  return { ok: true, answer: raw.answer, roles: checked.roles, enabled: agents };
}

/** D8 §13 read-only roster. ACF remains source of route, session verdict and member truth.
 * The caller cannot inject arbitrary ACF files, users, sessions or route settings. */
export async function readAcfTeamRoster(
  runId: unknown = undefined,
  runner: AcfRunner = defaultRunner,
  lister: SessionLister = defaultLister,
  registry: ReadonlyArray<{ apiAgentId: string; label: string }> | null = null,
): Promise<{ ok: true; answer: Record<string, unknown> } | { ok: false; code: string; detail: string }> {
  if (runId !== undefined && (typeof runId !== "string" || !RUN_ID_RE.test(runId))) {
    return { ok: false, code: "ARGUMENTS", detail: "Invalid runId" };
  }
  let candidates: Array<Record<string, unknown>>;
  try { candidates = candidateRows(await lister()); }
  catch (error) {
    return { ok: false, code: "SESSION_INDEX_UNAVAILABLE",
      detail: error instanceof Error ? error.message.slice(0, 300) : "session index unavailable" };
  }
  const targets = registry ?? (await import("@/lib/cockpit/agent-registry")).COCKPIT_AGENT_TARGETS;
  const agents = targets.map(target => ({ agent_id: target.apiAgentId, label: target.label }));
  const args: Record<string, unknown> = { routes_file: ACF_TEAM_ROOM_ROUTES, agents, candidates };
  if (runId) args.run_id = runId;
  return callAcf("team-roster", args, OTHER_TIMEOUT_MS, runner);
}

/** The run's bound roles, read from ACF's own team-view (R2). */
async function boundRoles(runId: string, runner: AcfRunner): Promise<{ ok: true; roles: string[] } | { ok: false; code: string; detail: string }> {
  const raw = await callAcf("team-view", { run_id: runId }, OTHER_TIMEOUT_MS, runner);
  if (!raw.ok) return raw;
  const participants = Array.isArray(raw.answer.participants) ? raw.answer.participants as Array<{ role?: unknown }> : [];
  return { ok: true, roles: participants.map((p) => String(p.role ?? "")).filter(Boolean) };
}

function bad(v: AcfControlVerb, detail: string): AcfControlResult {
  return { ok: false, verb: v, code: "ARGUMENTS", detail };
}

/** Validate the browser's request, build ACF's arguments, run the verb, return ACF's own answer or refusal. */
export async function runAcfControl(verb: unknown, args: unknown, runner: AcfRunner = defaultRunner,
                                    lister: SessionLister = defaultLister, enabled?: string[]): Promise<AcfControlResult> {
  if (typeof verb !== "string" || !(ACF_TEAM_CONTROL_VERBS as readonly string[]).includes(verb)) {
    return { ok: false, verb: null, code: "ARGUMENTS", detail: "Unsupported Team Room control verb" };
  }
  const v = verb as AcfControlVerb;
  const obj = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
  if (!obj) return bad(v, "JSON arguments required");

  let acfArgs: Record<string, unknown>;
  let timeout = OTHER_TIMEOUT_MS;
  if (v === "team-open-participants") {
    const goal = typeof obj.goal === "string" ? obj.goal.trim() : "";
    const criterion = typeof obj.success_criterion === "string" ? obj.success_criterion.trim() : "";
    if (goal.length > LIMITS.objective || hasControlChars(goal)) return bad(v, "Goal: at most 4000 characters, no control characters");
    if (criterion.length > LIMITS.criterion || hasControlChars(criterion)) return bad(v, "Invalid success criterion");
    const agents = enabled ?? await enabledTeamRoomAgents();
    const participants = validateD8Participants(obj.participants, agents);
    if (!participants) return bad(v, "1..8 unique participant handles and distinct enabled agent/session pairs required; functions are optional");
    const existing = await requireExistingMcSessions(participants, lister);
    if (existing) return { ok: false, verb: v, code: "SESSION_INDEX_UNAVAILABLE", detail: existing };
    acfArgs = buildD8OpenSpec(goal, participants, criterion);
    timeout = OPEN_TIMEOUT_MS;
  } else if (v === "team-open") {
    const objective = typeof obj.objective === "string" ? obj.objective.trim() : "";
    const criterion = typeof obj.success_criterion === "string" ? obj.success_criterion.trim() : "";
    if (!objective || objective.length > LIMITS.objective) return bad(v, `Objective: 1..${LIMITS.objective} characters`);
    if (!criterion) return bad(v, "Success criterion required");
    const chosen = await teamSessions({ roles: obj.roles, pins: obj.pins }, runner, lister, enabled);
    if (!chosen.ok) return { ok: false, verb: v, code: chosen.code, detail: chosen.detail };
    const bindings = chosen.answer.bindings as Record<string, TeamBinding | null> | undefined;
    if (chosen.answer.ready !== true || !bindings?.builder || !bindings?.reviewer) {
      return { ok: false, verb: v, code: "TEAM_SESSIONS_NOT_READY", detail: "No ready session for every role; nothing was opened",
               sessions: chosen.answer };
    }
    acfArgs = buildTeamOpenSpec(objective, criterion, bindings as Record<string, TeamBinding>);
    timeout = OPEN_TIMEOUT_MS;
  } else {
    const runId = typeof obj.run_id === "string" ? obj.run_id : "";
    if (!RUN_ID_RE.test(runId)) return bad(v, "run_id required");
    if (v === "team-stop") {
      // Use ACF Pass 1A's own team-stop. The same ACF core writes the
      // terminal state and owns in-flight/no-retry protections.
      const current = await callAcf("team-view", { run_id: runId }, OTHER_TIMEOUT_MS, runner);
      if (!current.ok) return { ok: false, verb: v, code: current.code, detail: current.detail };
      if (current.answer.schema !== 2) return bad(v, "Stop via Free Room is only for schema-2 runs");
      if (current.answer.in_flight) return { ok: false, verb: v, code: "TURN_OUTCOME_PENDING",
        detail: "ACF still has an open journal turn; reconcile its outcome before closing the run" };
      if (!["ACTIVE", "PAUSED"].includes(String(current.answer.run_status))) {
        return { ok: false, verb: v, code: "RUN_NOT_OPEN", detail: "ACF does not report an active or paused run" };
      }
      const reason = obj.reason === undefined ? "Operator stopped the Free Room" : obj.reason;
      if (typeof reason !== "string" || !reason.trim() || reason.length > LIMITS.reason ||
          hasControlChars(reason)) return bad(v, "Stop reason: 1..300 characters, no control characters");
      const stopped = await callAcf("team-stop", { run_id: runId, by: OPERATOR,
        reason: reason.trim() }, OTHER_TIMEOUT_MS, runner);
      if (!stopped.ok) return { ok: false, verb: v, code: stopped.code, detail: stopped.detail };
      return { ok: true, verb: v, result: stopped.answer };
    } else if (v === "team-task") {
      const v2 = await requireV2Run(runId, runner);
      if (!v2.ok) return { ok: false, verb: v, code: v2.code, detail: v2.detail };
      const taskId = typeof obj.task_id === "string" ? obj.task_id : "";
      const assignee = typeof obj.assignee === "string" ? obj.assignee : "";
      const brief = typeof obj.brief === "string" ? obj.brief.trim() : "";
      const reviewer = typeof obj.reviewer === "string" && obj.reviewer ? obj.reviewer : null;
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      if (!D8_TASK_RE.test(taskId) || !v2.participants.some(p => p.role === assignee)
        || (reviewer !== null && (!v2.participants.some(p => p.role === reviewer) || reviewer === assignee
          || v2.participants.find(p => p.role === reviewer)?.agent_id === v2.participants.find(p => p.role === assignee)?.agent_id))
        || !brief || brief.length > LIMITS.objective || hasControlChars(brief)
        || title.length > 200 || hasControlChars(title)) return bad(v, "Task ID T<n>, a bound assignee, optional distinct reviewer and text brief required");
      // ACF itself owns due turns, per-task review gates and file-writing refusals.
      acfArgs = { run_id: runId, by: OPERATOR, task_id: taskId, assignee, brief,
        ...(reviewer ? { reviewer } : {}), ...(title ? { title } : {}) };
    } else if (v === "team-join") {
      const v2 = await requireV2Run(runId, runner);
      if (!v2.ok) return { ok: false, verb: v, code: v2.code, detail: v2.detail };
      const agents = enabled ?? await enabledTeamRoomAgents();
      const participants = validateD8Participants([{
        handle: obj.handle, agent_id: obj.agent_id, session_ref: obj.session_ref, roles: obj.roles ?? [],
      }], agents);
      if (!participants) return bad(v, "Handle, enabled agent, own registered session and optional functions required");
      if (v2.participants.some(p => p.role === participants[0].handle
        || (p.agent_id === participants[0].agent_id && p.session_ref === participants[0].session_ref))) {
        return { ok: false, verb: v, code: "D8_PARTICIPANT_EXISTS", detail: "Existing participant identity may not be rebound; join a different independent session" };
      }
      const existing = await requireExistingMcSessions(participants, lister);
      if (existing) return { ok: false, verb: v, code: "SESSION_INDEX_UNAVAILABLE", detail: existing };
      acfArgs = { run_id: runId, by: OPERATOR, ...participants[0] };
    } else if (v === "team-step") {
      acfArgs = { run_id: runId, by: OPERATOR, live: true };
      timeout = STEP_TIMEOUT_MS;
    } else if (v === "team-reconcile") {
      acfArgs = { run_id: runId, by: OPERATOR };
    } else if (v === "team-reconcile-late") {
      const v2 = await requireV2Run(runId, runner);
      if (!v2.ok) return { ok: false, verb: v, code: v2.code, detail: v2.detail };
      // READS the native session's recorded history; may reconcile into ACF's
      // journal, but never sends another participant/model prompt.
      acfArgs = { run_id: runId, by: OPERATOR };
    } else if (v === "team-consensus-propose") {
      const v2 = await requireV2Run(runId, runner);
      if (!v2.ok) return { ok: false, verb: v, code: v2.code, detail: v2.detail };
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text || text.length > LIMITS.say || hasControlChars(text)) {
        return bad(v, "Explicit operator consensus proposal required (1..6000 characters)");
      }
      const participants = obj.participants;
      const handles = v2.participants.map(p => p.role);
      if (participants !== undefined && (!Array.isArray(participants) || !participants.length ||
        new Set(participants).size !== participants.length ||
        participants.some(p => typeof p !== "string" || !handles.includes(p)))) {
        return bad(v, "Consensus must name one or more distinct, bound participant handles");
      }
      acfArgs = { run_id: runId, by: OPERATOR, text,
        ...(participants === undefined ? {} : { participants }) };
    } else if (v === "team-intervene") {
      const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
      if (!reason || reason.length > LIMITS.reason || hasControlChars(reason)) return bad(v, `Reason: one line, 1..${LIMITS.reason} characters`);
      acfArgs = { run_id: runId, by: OPERATOR, reason };
    } else if (v === "team-say") {
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text || text.length > LIMITS.say) return bad(v, `Message: 1..${LIMITS.say} characters`);
      let kind = obj.kind === undefined ? "QUESTION" : obj.kind;
      let reply = obj.reply === undefined ? true : obj.reply;
      if (kind !== "QUESTION" && kind !== "NOTE") return bad(v, "kind: QUESTION or NOTE");
      if (typeof reply !== "boolean") return bad(v, "reply: true or false");
      const to = obj.to;
      if (to === "ORCHESTRATOR") {
        kind = "QUESTION";                 // R2: the orchestrator answers a QUESTION, always with a reply
        reply = true;
      } else if (to !== "TEAM") {
        const wanted = typeof to === "string" ? [to] : Array.isArray(to) ? to : null;
        if (!wanted || wanted.length === 0 || wanted.some((r) => typeof r !== "string" || !ROLE_RE.test(r))
            || new Set(wanted).size !== wanted.length) {
          return bad(v, "to: a bound role, a list of bound roles, TEAM or ORCHESTRATOR");
        }
        const bound = await boundRoles(runId, runner);
        if (!bound.ok) return { ok: false, verb: v, code: bound.code, detail: bound.detail };
        const unknown = (wanted as string[]).filter((r) => !bound.roles.includes(r));
        if (unknown.length) return { ok: false, verb: v, code: "ROLE_UNBOUND", detail: unknown.join(",") };
      }
      acfArgs = { run_id: runId, by: OPERATOR, to, text, kind, reply };
    } else if (v === "team-collaborate") {
      const v2 = await requireV2Run(runId, runner);
      if (!v2.ok) return { ok: false, verb: v, code: v2.code, detail: v2.detail };
      const rounds = obj.rounds === undefined ? 1 : obj.rounds;
      const topic = obj.topic === undefined ? "" : obj.topic;
      const participants = obj.participants;
      if (!Number.isInteger(rounds) || (rounds as number) < 1 || (rounds as number) > 4) return bad(v, "Samenwerken: rounds must be 1..4");
      if (typeof topic !== "string" || topic.length > LIMITS.objective || hasControlChars(topic)) return bad(v, "Samenwerken: invalid topic");
      const bound = v2.participants.map(p => p.role);
      if (participants !== undefined && (!Array.isArray(participants) || participants.length < 2
          || participants.some(x => typeof x !== "string" || !bound.includes(x))
          || new Set(participants).size !== participants.length)) return bad(v, "Samenwerken: choose at least 2 distinct bound participants");
      acfArgs = { run_id: runId, by: OPERATOR, rounds,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        ...(participants === undefined ? {} : { participants }) };
    } else if (v === "team-resume") {
      if (obj.abandon_owed_replies !== undefined && typeof obj.abandon_owed_replies !== "boolean") return bad(v, "abandon_owed_replies: boolean");
      acfArgs = { run_id: runId, by: OPERATOR, abandon_owed_replies: obj.abandon_owed_replies === true };
    } else if (v === "team-rebind") {
      const role = typeof obj.role === "string" ? obj.role : "";
      const session = typeof obj.session_ref === "string" ? obj.session_ref : "";
      if (!ROLE_RE.test(role)) return bad(v, "role required");
      if (!SESSION_RE.test(session)) return bad(v, "session_ref: a Mission Control session name");
      acfArgs = { run_id: runId, by: OPERATOR, role, session_ref: session };
      if (obj.agent_id !== undefined) {
        const agents = enabled ?? await enabledTeamRoomAgents();
        if (typeof obj.agent_id !== "string" || !agents.includes(obj.agent_id)) return bad(v, "agent_id: an agent with an enabled route");
        acfArgs.agent_id = obj.agent_id;
      }
      timeout = OPEN_TIMEOUT_MS;
    } else {
      // team-continue: a linked successor; the predecessor is never reopened (contract §10)
      const instruction = typeof obj.instruction === "string" ? obj.instruction.trim() : "";
      if (!instruction || instruction.length > LIMITS.instruction) return bad(v, `Instruction: 1..${LIMITS.instruction} characters`);
      acfArgs = { predecessor_run_id: runId, run_id: newRunId(), created_by: OPERATOR, instruction };
      timeout = OPEN_TIMEOUT_MS;
    }
  }

  const raw = await callAcf(v, acfArgs, timeout, runner);
  if (!raw.ok) return { ok: false, verb: v, code: raw.code, detail: raw.detail };
  return { ok: true, verb: v, result: raw.answer };
}

/**
 * A step makes a real participant turn and may take minutes; proxies and browsers should not hold a request that long.
 * So a step runs in the background of this Mission Control process; the browser asks for its status and sees the
 * turn appear through the normal read side. One step per run at a time; ACF itself also refuses overlapping writes.
 * During an open intervention ACF makes the oldest owed reply instead of an autonomous turn (contract §8).
 */
type StepState = { running: boolean; startedAt: string; finishedAt: string | null; last: AcfControlResult | null };
const STEPS: Map<string, StepState> = ((globalThis as Record<string, unknown>).__acfTeamRoomSteps ??= new Map()) as Map<string, StepState>;

export function stepStatus(runId: string): StepState | null {
  return STEPS.get(runId) ?? null;
}

export function startTeamStep(runId: unknown, runner: AcfRunner = defaultRunner): AcfControlResult {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    return { ok: false, verb: "team-step", code: "ARGUMENTS", detail: "run_id required" };
  }
  const current = STEPS.get(runId);
  if (current?.running) return { ok: false, verb: "team-step", code: "STEP_ALREADY_RUNNING", detail: `since ${current.startedAt}` };
  const state: StepState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, last: null };
  STEPS.set(runId, state);
  void runAcfControl("team-step", { run_id: runId }, runner).then((result) => {
    state.last = result;
  }).catch((error: unknown) => {
    state.last = { ok: false, verb: "team-step", code: "ACF_UNAVAILABLE", detail: error instanceof Error ? error.message : "step failed" };
  }).finally(() => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
  });
  return { ok: true, verb: "team-step", result: { started: true, run_id: runId, started_at: state.startedAt } };
}

/** A write verb other than team-step must not race a running background step of the same run. */
export function stepRunning(runId: unknown): boolean {
  return typeof runId === "string" && STEPS.get(runId)?.running === true;
}

/** Kept for callers that hash arguments for display. */
export function canonicalAcfJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("ACF_CANONICAL_ARGUMENTS_INVALID");
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAcfJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${JSON.stringify(k)}:${canonicalAcfJson(val)}`).join(",")}}`;
  }
  throw new Error("ACF_CANONICAL_ARGUMENTS_INVALID");
}

export function acfArgsSha256(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalAcfJson(args), "utf8").digest("hex");
}
