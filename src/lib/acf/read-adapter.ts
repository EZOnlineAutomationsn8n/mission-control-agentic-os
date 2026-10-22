import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AcfIndexExport,
  AcfMessageReadModel,
  AcfParticipantReadModel,
  AcfProofPointer,
  AcfRunExport,
  AcfRunSummary,
  AcfTaskReadModel,
  AcfTeamRoomRun,
  AcfTeamViewV1,
  AcfTeamRoomSnapshot,
} from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_ACF_ROOT = "/workspace/projects/agentic-collaboration-fabric";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export type AcfCommandRunner = (args: string[]) => Promise<string>;

class AcfReadError extends Error {
  readonly code: "ACF_UNAVAILABLE" | "MALFORMED_EXPORT";

  constructor(code: "ACF_UNAVAILABLE" | "MALFORMED_EXPORT", message: string) {
    super(message);
    this.name = "AcfReadError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) throw new Error("top-level JSON is not an object");
    return value;
  } catch (error) {
    throw new AcfReadError(
      "MALFORMED_EXPORT",
      `${label}: ${error instanceof Error ? error.message : "invalid JSON"}`
    );
  }
}

function assertIndexExport(value: Record<string, unknown>): AcfIndexExport {
  if (value.export_version !== 1 || !Array.isArray(value.runs)) {
    throw new AcfReadError("MALFORMED_EXPORT", "ACF runs export is missing export_version=1 or runs[]");
  }
  return value as unknown as AcfIndexExport;
}

function assertRunExport(value: Record<string, unknown>, expectedRunId: string): AcfRunExport {
  if (
    value.export_version !== 1 ||
    value.run_id !== expectedRunId ||
    typeof value.last_seq !== "number" ||
    typeof value.state_hash !== "string" ||
    !isRecord(value.state)
  ) {
    throw new AcfReadError("MALFORMED_EXPORT", `ACF export-run payload is invalid for ${expectedRunId}`);
  }
  return value as unknown as AcfRunExport;
}

function defaultRunner(projectRoot: string, stateDir?: string): AcfCommandRunner {
  return async (args) => {
    try {
      const { stdout } = await execFileAsync("./acf", stateDir ? [...args, "--state-dir",stateDir] : args, {
        cwd: projectRoot,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
        },
        timeout: Number(process.env.ACF_READ_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
        maxBuffer: MAX_BUFFER,
        encoding: "utf8",
      });
      return String(stdout);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "ACF command failed";
      throw new AcfReadError("ACF_UNAVAILABLE", detail);
    }
  };
}

function mapIndexRun(value: unknown): AcfRunSummary {
  if (!isRecord(value)) throw new AcfReadError("MALFORMED_EXPORT", "ACF runs[] item is not an object");
  const runId = stringValue(value.run_id);
  const goal = stringValue(value.goal);
  const project = stringValue(value.project);
  const runState = stringValue(value.status);
  const lastSequence = numberValue(value.last_seq);
  const stateHash = stringValue(value.state_hash);
  const leaseEpoch = numberValue(value.epoch);
  const taskCountsRaw = value.tasks;
  if (
    !runId ||
    goal === null ||
    project === null ||
    runState === null ||
    lastSequence === null ||
    !stateHash ||
    leaseEpoch === null ||
    !isRecord(taskCountsRaw)
  ) {
    throw new AcfReadError("MALFORMED_EXPORT", "ACF runs[] item is missing required fields");
  }
  const taskCounts: Record<string, number> = {};
  for (const [key, count] of Object.entries(taskCountsRaw)) {
    if (typeof count !== "number" || !Number.isFinite(count)) {
      throw new AcfReadError("MALFORMED_EXPORT", `ACF task count ${key} is invalid`);
    }
    taskCounts[key] = count;
  }
  const orchestrator = stringValue(value.orchestrator);
  return {
    runId,
    goal,
    project,
    runState,
    lastSequence,
    stateHash,
    leaseHolder: orchestrator,
    leaseEpoch,
    orchestratorAdapter: orchestrator,
    orchestratorIdentityVerification: orchestrator ? "CLAIMED" : "UNKNOWN",
    taskCounts,
  };
}

function mapTask(taskId: string, value: unknown): AcfTaskReadModel {
  if (!isRecord(value)) throw new AcfReadError("MALFORMED_EXPORT", `task ${taskId} is not an object`);
  const state = stringValue(value.status);
  if (!state) throw new AcfReadError("MALFORMED_EXPORT", `task ${taskId} has no status`);
  return {
    taskId,
    title: stringValue(value.title) ?? taskId,
    role: stringValue(value.role),
    taskState: state,
    dependsOn: stringArray(value.depends_on),
    iteration: numberValue(value.iteration),
    maxIterations: numberValue(value.max_iterations),
    needsDecisionReason: stringValue(value.needs_decision_reason),
    reviewOf: stringValue(value.review_of),
    reviewVerdict: stringValue(value.review_verdict),
  };
}

function mapParticipant(role: string, value: unknown): AcfParticipantReadModel {
  if (!isRecord(value)) throw new AcfReadError("MALFORMED_EXPORT", `participant ${role} is not an object`);
  return {
    role,
    participantId: stringValue(value.participant_id),
    agentId: stringValue(value.agent_id),
    sessionRef: stringValue(value.session_ref),
    // ACF CURRENT_STATE explicitly says orchestrator/participant identity remains claims.
    identityVerificationState: "CLAIMED",
  };
}

function mapMessages(messages: unknown[], events: unknown[] | undefined): AcfMessageReadModel[] {
  const eventByMessageId = new Map<string, Record<string, unknown>>();

  for (const event of events ?? []) {
    if (!isRecord(event) || event.type !== "MESSAGE_POSTED" || !isRecord(event.data)) continue;
    const messageId = stringValue(event.data.message_id);
    if (messageId) eventByMessageId.set(messageId, event);
  }

  return messages.map((value, index) => {
    if (!isRecord(value)) throw new AcfReadError("MALFORMED_EXPORT", `message ${index} is not an object`);

    const messageId = stringValue(value.message_id);
    const kind = stringValue(value.kind);
    const from = stringValue(value.from);
    const to = stringValue(value.to);
    const body = stringValue(value.body);
    const sequence = numberValue(value.seq);
    const answered = booleanValue(value.answered);

    if (
      !messageId ||
      !kind ||
      !["NOTE", "QUESTION", "ANSWER"].includes(kind) ||
      !from ||
      !to ||
      body === null ||
      sequence === null ||
      answered === null
    ) {
      throw new AcfReadError("MALFORMED_EXPORT", `message ${messageId ?? index} is missing required fields`);
    }

    const event = eventByMessageId.get(messageId);
    const eventData = event && isRecord(event.data) ? event.data : null;
    const originRaw = eventData && isRecord(eventData.origin) ? eventData.origin : null;
    const externalRaw = originRaw && isRecord(originRaw.external) ? originRaw.external : null;

    return {
      messageId,
      kind: kind as AcfMessageReadModel["kind"],
      from,
      to,
      body,
      inReplyTo: stringValue(value.in_reply_to),
      answered,
      sequence,
      at: event ? stringValue(event.at) : null,
      origin: originRaw
        ? {
            via: stringValue(originRaw.via),
            turnId: stringValue(originRaw.turn_id),
            participantId: stringValue(originRaw.participant_id),
            agentId: stringValue(originRaw.agent_id),
            sessionRef: stringValue(originRaw.session_ref),
            contextThroughSequence: numberValue(originRaw.context_through_seq),
            basedOnSequence: numberValue(originRaw.based_on_seq),
            conversationRef: externalRaw ? stringValue(externalRaw.conversation_ref) : null,
            responseSha256: externalRaw ? stringValue(externalRaw.response_sha256) : null,
          }
        : null,
    };
  });
}

function executionProofPointers(tasks: Record<string, unknown>): AcfProofPointer[] {
  const pointers: AcfProofPointer[] = [];
  const seen = new Set<string>();
  const acceptedKeys = new Set(["proof", "proof_ref", "evidence", "evidence_ref", "receipt", "receipt_ref"]);

  for (const task of Object.values(tasks)) {
    if (!isRecord(task) || !Array.isArray(task.executions)) continue;
    for (const execution of task.executions) {
      if (!isRecord(execution)) continue;
      for (const [key, value] of Object.entries(execution)) {
        if (!acceptedKeys.has(key) || typeof value !== "string" || !value.trim()) continue;
        const normalized = value.trim();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        pointers.push({ kind: "execution_reference", value: normalized });
      }
    }
  }
  return pointers;
}

export function parseTeamViewV1(raw: string, expectedRunId: string, detail: AcfRunExport): AcfTeamViewV1 {
  const v=parseJsonObject(raw,'team-view');
  const sourceRun=isRecord(detail.state.run)?detail.state.run:null;
  if(v.view_version!==1 || v.run_id!==expectedRunId || typeof v.run_status!=='string' ||
     (sourceRun && (v.run_status!==sourceRun.status || v.objective!==sourceRun.goal || v.project!==sourceRun.project)) ||
     typeof v.team_run_completed!=='boolean' || !isRecord(v.completion) || v.completion.completed!==v.team_run_completed ||
     typeof v.state_hash!=='string' ||
     typeof v.last_seq!=='number' || !(v.replay_matches_record===null || typeof v.replay_matches_record==='boolean') ||
     v.state_hash!==detail.state_hash || v.last_seq!==detail.last_seq ||
     v.replay_matches_record!==(detail.replay_matches_record??null) ||
     !Array.isArray(v.participants) || !Array.isArray(v.turns) || !(v.loop===null || isRecord(v.loop)) || !isRecord(v.completion) ||
     !(v.in_flight===null || isRecord(v.in_flight)) ||
     !(v.acceptance===null || isRecord(v.acceptance)) ||
     !(v.next_safe_action===null || typeof v.next_safe_action==='string') ||
     !(v.reentry_point===null || isRecord(v.reentry_point)))
    throw new AcfReadError('MALFORMED_EXPORT','ACF team-view v1 invalid or inconsistent with export-run');
  return v as unknown as AcfTeamViewV1;
}

function mapRunDetail(value: AcfRunExport): AcfTeamRoomRun {
  const state = value.state;
  const run = state.run;
  const lease = state.lease;
  const tasks = state.tasks;
  const participants = state.participants;
  const messages = state.messages;

  if (!isRecord(run) || !isRecord(lease) || !isRecord(tasks) || !isRecord(participants) || !Array.isArray(messages)) {
    throw new AcfReadError("MALFORMED_EXPORT", "ACF run state is missing run/lease/tasks/participants/messages");
  }

  const runId = stringValue(run.run_id);
  const goal = stringValue(run.goal);
  const project = stringValue(run.project);
  const runState = stringValue(run.status);
  const leaseEpoch = numberValue(lease.epoch);
  if (!runId || goal === null || project === null || runState === null || leaseEpoch === null) {
    throw new AcfReadError("MALFORMED_EXPORT", "ACF run state has invalid core fields");
  }

  const orchestrator = stringValue(lease.adapter_id);
  const taskState = Object.entries(tasks).map(([taskId, task]) => mapTask(taskId, task));
  const participantState = Object.entries(participants).map(([role, participant]) => mapParticipant(role, participant));
  const messageState = mapMessages(messages, value.events);
  const blockerReasons = taskState
    .map((task) => task.needsDecisionReason)
    .filter((reason): reason is string => Boolean(reason));

  let lastType: string | null = null;
  let lastAt: string | null = null;
  if (Array.isArray(value.events) && value.events.length > 0) {
    const lastEvent = value.events[value.events.length - 1];
    if (isRecord(lastEvent)) {
      lastType = stringValue(lastEvent.type);
      lastAt = stringValue(lastEvent.at);
    }
  }

  const proofPointers: AcfProofPointer[] = [
    { kind: "state_hash", value: value.state_hash },
    ...executionProofPointers(tasks),
  ];
  if (typeof value.recorded_state_hash === "string" && value.recorded_state_hash !== value.state_hash) {
    proofPointers.push({ kind: "recorded_state_hash", value: value.recorded_state_hash });
  }

  return {
    runId,
    goal,
    project,
    runState,
    teamView: null,
    taskState,
    leaseHolder: orchestrator,
    leaseEpoch,
    orchestratorAdapter: orchestrator,
    orchestratorIdentityVerification: orchestrator ? "CLAIMED" : "UNKNOWN",
    participants: participantState,
    messages: messageState,
    blocker: blockerReasons.length > 0 ? blockerReasons.join(" | ") : null,
    blockerEvidenceState: blockerReasons.length > 0 ? "CLAIMED" : "UNKNOWN",
    // The current ACF export contract does not publish these fields per run.
    reentryPoint: null,
    nextSafeAction: null,
    proofPointers,
    lastEventOrSequence: {
      sequence: value.last_seq,
      type: lastType,
      at: lastAt,
    },
    stateHash: value.state_hash,
    replayMatchesRecord: booleanValue(value.replay_matches_record),
  };
}

export async function readAcfTeamRoomSnapshot(options: {
  runId?: string | null;
  projectRoot?: string;
  stateDir?: string;
  runner?: AcfCommandRunner;
  now?: () => Date;
} = {}): Promise<AcfTeamRoomSnapshot> {
  const projectRoot = options.projectRoot || process.env.ACF_PROJECT_ROOT || DEFAULT_ACF_ROOT;
  // Default: Dennis's working Team Room home (state/team-room, RECORD_ONLY, no signing). ACF_STATE_DIR overrides it.
  const stateDir=options.stateDir ?? process.env.ACF_STATE_DIR ?? `${projectRoot}/state/team-room`;
  const runner = options.runner || defaultRunner(projectRoot,stateDir);
  const observedAt = (options.now || (() => new Date()))().toISOString();
  const sourceConfigured=true;
  const provenanceClass = stateDir === "/workspace/projects/agentic-collaboration-fabric/proofs/live/ACF_TEAM_ROOM_01_LIVE_1_READ_HOME" && projectRoot === "/workspace/projects/agentic-collaboration-fabric" ? "CERTIFIED_HISTORICAL_READ_SNAPSHOT" as const : "CONFIGURED_ACF_SOURCE_UNVERIFIED" as const;
  const source={projectRoot,stateDir:stateDir??null,sourceConfigured,provenanceClass,commandSurface:"./acf runs + ./acf export-run + ./acf team-view" as const,readOnly:true as const};
  if(!sourceConfigured)return {availability:"unavailable",observedAt,source,runs:[],selectedRun:null,noRealTeamRunYet:false,error:"ACF_READ_SOURCE_NOT_CONFIGURED: set ACF_PROJECT_ROOT and explicit ACF_STATE_DIR for the intended run home"};

  try {
    const indexRaw = await runner(["runs"]);
    const index = assertIndexExport(parseJsonObject(indexRaw, "runs"));
    const runs = index.runs.map(mapIndexRun);

    if (runs.length === 0) {
      return {
        availability: "empty",
        observedAt,
        source,
        runs: [],
        selectedRun: null,
        noRealTeamRunYet: true,
        error: null,
      };
    }

    const selectedId = options.runId || runs[0].runId;
    const selectedSummary = runs.find((run) => run.runId === selectedId);
    if (!selectedSummary) {
      throw new AcfReadError("MALFORMED_EXPORT", `requested run ${selectedId} is not present in ./acf runs`);
    }

    const detailRaw = await runner(["export-run", "--args", JSON.stringify({ run_id: selectedId })]);
    const detail = assertRunExport(parseJsonObject(detailRaw, "export-run"), selectedId);
    const teamRaw=await runner(["team-view","--args",JSON.stringify({run_id:selectedId})]);
    const teamView=parseTeamViewV1(teamRaw,selectedId,detail);
    if (source.provenanceClass === "CERTIFIED_HISTORICAL_READ_SNAPSHOT" && (selectedId !== "RUN-ACF-TEAM-ROOM-01-LIVE-1" || detail.last_seq !== 9 || detail.state_hash !== "dde29d6f640989a4cbfe7cd972913422a1f407b1a639040e0b837d2e3a1c9580" || detail.replay_matches_record !== true || teamView.run_status !== "ACTIVE" || teamView.loop?.status !== "STOPPED_ACCEPTED" || teamView.team_run_completed || teamView.in_flight !== null)) throw new AcfReadError("MALFORMED_EXPORT","CERTIFIED_HISTORICAL_SNAPSHOT_INTEGRITY_MISMATCH");
    const selectedRun=mapRunDetail(detail);
    selectedRun.teamView=teamView;
    selectedRun.runState=teamView.run_status;
    selectedRun.nextSafeAction=teamView.next_safe_action;
    selectedRun.reentryPoint=teamView.reentry_point?JSON.stringify(teamView.reentry_point):null;

    return {
      availability: "available",
      observedAt,
      source,
      runs,
      selectedRun,
      noRealTeamRunYet: false,
      error: null,
    };
  } catch (error) {
    if (error instanceof AcfReadError) {
      return {
        availability: error.code === "MALFORMED_EXPORT" ? "malformed" : "unavailable",
        observedAt,
        source,
        runs: [],
        selectedRun: null,
        noRealTeamRunYet: false,
        error: error.message,
      };
    }
    return {
      availability: "unavailable",
      observedAt,
      source,
      runs: [],
      selectedRun: null,
      noRealTeamRunYet: false,
      error: error instanceof Error ? error.message : "ACF read failed",
    };
  }
}
