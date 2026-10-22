import assert from "node:assert/strict";
import test from "node:test";
import { readAcfTeamRoomSnapshot, type AcfCommandRunner } from "../src/lib/acf/read-adapter";
import { acfReadPresentation } from "../src/lib/acf/freshness";
import {
  buildTeamRoomDiscussion,
  collapseCurrentFocus,
  focusParticipant,
  modeDefinition,
  resolveFocusedRole,
} from "../src/lib/acf/team-room-view-model";
import type { AcfTeamRoomRun } from "../src/lib/acf/types";
import {
  deriveParticipantReadiness,
  roleClassForAgent,
  type ParticipantReadinessInput,
} from "../src/lib/acf/participant-readiness";

const NOW = () => new Date("2026-10-06T20:00:00.000Z");

function runnerFor(responses: Record<string, string | Error>): AcfCommandRunner {
  return async (args) => {
    const key = args.join(" ");
    const value = responses[key];
    if (value instanceof Error) throw value;
    if (typeof value !== "string") throw new Error(`unexpected command: ${key}`);
    return value;
  };
}

const indexOne = JSON.stringify({
  export_version: 1,
  runs: [{
    run_id: "RUN-1",
    goal: "bounded synthetic test",
    project: "MISSION_CONTROL_AGENTIC_OS",
    status: "ACTIVE",
    last_seq: 8,
    state_hash: "hash-8",
    orchestrator: "ANTIGRAVITY",
    epoch: 3,
    orchestrator_switches: 1,
    tasks: { OPEN: 1, NEEDS_DECISION: 1 },
  }],
});

function detailFixture(overrides: { messages?: unknown[]; events?: unknown[] } = {}) {
  const messages = overrides.messages ?? [
    { message_id: "M1", kind: "QUESTION", from: "researcher", to: "reviewer", body: "Pick one", in_reply_to: null, answered: true, seq: 6 },
    { message_id: "M2", kind: "ANSWER", from: "reviewer", to: "researcher", body: "Choose ORBIT", in_reply_to: "M1", answered: false, seq: 7 },
    { message_id: "M3", kind: "NOTE", from: "researcher", to: "OPERATOR", body: "Reviewer chose ORBIT", in_reply_to: null, answered: false, seq: 8 },
  ];
  const events = overrides.events ?? [
    {
      seq: 6,
      type: "MESSAGE_POSTED",
      at: "2026-10-06T19:58:00Z",
      data: {
        message_id: "M1",
        origin: {
          via: "PARTICIPANT_DIALOGUE",
          turn_id: "RUN-1:researcher:S5",
          participant_id: "RUN-1:researcher",
          agent_id: "hermes",
          session_ref: "sess-hermes",
          context_through_seq: 5,
          based_on_seq: 5,
          external: { conversation_ref: "conv-hermes-1", response_sha256: "sha-hermes-1" },
        },
      },
    },
    {
      seq: 7,
      type: "MESSAGE_POSTED",
      at: "2026-10-06T19:59:00Z",
      data: {
        message_id: "M2",
        origin: {
          via: "PARTICIPANT_DIALOGUE",
          turn_id: "RUN-1:reviewer:S6",
          participant_id: "RUN-1:reviewer",
          agent_id: "claude-code",
          session_ref: "sess-claude",
          context_through_seq: 6,
          based_on_seq: 6,
          external: { conversation_ref: "conv-claude-1", response_sha256: "sha-claude-1" },
        },
      },
    },
    {
      seq: 8,
      type: "MESSAGE_POSTED",
      at: "2026-10-06T19:59:30Z",
      data: {
        message_id: "M3",
        origin: {
          via: "PARTICIPANT_DIALOGUE",
          turn_id: "RUN-1:researcher:S7",
          participant_id: "RUN-1:researcher",
          agent_id: "hermes",
          session_ref: "sess-hermes",
          context_through_seq: 7,
          based_on_seq: 7,
          external: { conversation_ref: "conv-hermes-2", response_sha256: "sha-hermes-2" },
        },
      },
    },
  ];

  return JSON.stringify({
    export_version: 1,
    run_id: "RUN-1",
    last_seq: 8,
    state_hash: "hash-8",
    recorded_state_hash: "hash-8",
    replay_matches_record: true,
    state: {
      run: {
        run_id: "RUN-1",
        goal: "bounded synthetic test",
        project: "MISSION_CONTROL_AGENTIC_OS",
        status: "ACTIVE",
      },
      lease: { adapter_id: "ANTIGRAVITY", epoch: 3 },
      participants: {
        researcher: { participant_id: "RUN-1:researcher", agent_id: "hermes", session_ref: "sess-hermes" },
        reviewer: { participant_id: "RUN-1:reviewer", agent_id: "claude-code", session_ref: "sess-claude" },
      },
      tasks: {
        T1: {
          task_id: "T1", title: "Read", role: "researcher", status: "OPEN", depends_on: [],
          iteration: 1, max_iterations: 2, needs_decision_reason: null, review_of: null, review_verdict: null,
          executions: [{ evidence_ref: "proof://T1/1" }],
        },
        T2: {
          task_id: "T2", title: "Wait", role: "reviewer", status: "NEEDS_DECISION", depends_on: ["T1"],
          iteration: 1, max_iterations: 1, needs_decision_reason: "WAITING_AUTHORITY", review_of: "T1", review_verdict: null,
          executions: [],
        },
      },
      task_order: ["T1", "T2"],
      decisions: [],
      messages,
    },
    events,
  });
}

function teamViewFixture(detailRaw: string) {
  const d=JSON.parse(detailRaw) as {run_id:string;state_hash:string;last_seq:number;replay_matches_record:boolean;state:{run:{status:string}}};
  return JSON.stringify({view_version:1,run_id:d.run_id,objective:"bounded synthetic test",project:"MISSION_CONTROL_AGENTIC_OS",run_status:d.state.run.status,team_run_completed:false,state_hash:d.state_hash,last_seq:d.last_seq,replay_matches_record:d.replay_matches_record,
    next_safe_action:'TEAM_STEP_REQUIRES_OPERATOR',reentry_point:{journal:'fixture.team.steps.jsonl'},participants:[],turns:[],in_flight:null,loop:null,acceptance:null,completion:{completed:false,why_not:'RUN_NOT_COMPLETE'}});
}

async function mappedRun(detail = detailFixture()): Promise<AcfTeamRoomRun> {
  const snapshot = await readAcfTeamRoomSnapshot({
    runner: runnerFor({
      runs: indexOne,
      'export-run --args {"run_id":"RUN-1"}': detail,
      'team-view --args {"run_id":"RUN-1"}': teamViewFixture(detail),
    }),
    now: NOW,
    projectRoot: "/acf",
  });
  assert.equal(snapshot.availability, "available");
  assert.ok(snapshot.selectedRun);
  return snapshot.selectedRun;
}

test("ACF_EMPTY -> truthful NO_REAL_TEAM_RUN_YET state", async () => {
  const snapshot = await readAcfTeamRoomSnapshot({
    runner: runnerFor({ runs: JSON.stringify({ export_version: 1, runs: [] }) }),
    now: NOW,
    projectRoot: "/acf",
  });
  assert.equal(snapshot.availability, "empty");
  assert.equal(snapshot.noRealTeamRunYet, true);
  assert.equal(snapshot.selectedRun, null);
});

test("ACF_AVAILABLE -> maps canonical run export without upgrading identity claims", async () => {
  const run = await mappedRun();
  assert.equal(run.leaseHolder, "ANTIGRAVITY");
  assert.equal(run.leaseEpoch, 3);
  assert.equal(run.orchestratorIdentityVerification, "CLAIMED");
  assert.equal(run.participants[0]?.identityVerificationState, "CLAIMED");
  assert.equal(run.blocker, "WAITING_AUTHORITY");
  assert.equal(run.blockerEvidenceState, "CLAIMED");
  assert.equal(run.reentryPoint, JSON.stringify({journal:"fixture.team.steps.jsonl"}));
  assert.equal(run.nextSafeAction, "TEAM_STEP_REQUIRES_OPERATOR");
  assert.equal(run.proofPointers.some((p) => p.value === "proof://T1/1"), true);
  assert.equal(run.lastEventOrSequence.sequence, 8);
  assert.equal(run.lastEventOrSequence.type, "MESSAGE_POSTED");
  assert.equal(run.replayMatchesRecord, true);
});

test("MESSAGE_POSTED read model preserves body, lineage, timestamp and participant-dialogue provenance", async () => {
  const run = await mappedRun();
  assert.equal(run.messages.length, 3);
  assert.equal(run.messages[1]?.inReplyTo, "M1");
  assert.equal(run.messages[1]?.at, "2026-10-06T19:59:00Z");
  assert.equal(run.messages[1]?.origin?.agentId, "claude-code");
  assert.equal(run.messages[1]?.origin?.sessionRef, "sess-claude");
  assert.equal(run.messages[1]?.origin?.conversationRef, "conv-claude-1");
  assert.equal(run.messages[1]?.origin?.contextThroughSequence, 6);
});

test("one latest reply per participant is derived without duplicating historic replies", async () => {
  const model = buildTeamRoomDiscussion(await mappedRun());
  const researcher = model.participants.find((participant) => participant.role === "researcher");
  const reviewer = model.participants.find((participant) => participant.role === "reviewer");
  assert.equal(researcher?.latestReply?.messageId, "M3");
  assert.equal(researcher?.previousReplyCount, 1);
  assert.equal(reviewer?.latestReply?.messageId, "M2");
  assert.equal(reviewer?.previousReplyCount, 0);
});

test("latest participant message becomes automatic focus while current in-flight speaker remains NOT_EXPORTED", async () => {
  const model = buildTeamRoomDiscussion(await mappedRun());
  assert.equal(model.latestParticipantRole, "researcher");
  assert.equal(model.currentSpeakerRole, null);
  assert.equal(model.currentSpeakerState, "NOT_EXPORTED");
  assert.equal(resolveFocusedRole(model, { role: null, sequence: null }), "researcher");
});

test("new participant turn automatically replaces prior focus", async () => {
  const prior = buildTeamRoomDiscussion(await mappedRun());
  const oldPreference = focusParticipant("researcher", prior.latestParticipantMessage?.sequence ?? null);

  const detail = JSON.parse(detailFixture()) as {
    state: { messages: unknown[] };
    events: unknown[];
    last_seq: number;
    state_hash: string;
    recorded_state_hash: string;
  };
  detail.state.messages.push({
    message_id: "M4", kind: "NOTE", from: "reviewer", to: "OPERATOR", body: "New reviewer turn",
    in_reply_to: null, answered: false, seq: 9,
  });
  detail.events.push({
    seq: 9, type: "MESSAGE_POSTED", at: "2026-10-06T20:00:00Z",
    data: { message_id: "M4" },
  });
  detail.last_seq = 9;
  detail.state_hash = "hash-9";
  detail.recorded_state_hash = "hash-9";

  const next = buildTeamRoomDiscussion(await mappedRun(JSON.stringify(detail)));
  assert.equal(next.latestParticipantRole, "reviewer");
  assert.equal(resolveFocusedRole(next, oldPreference), "reviewer");
});

test("manual collapse and manual participant focus are view-only and scoped to current latest sequence", async () => {
  const model = buildTeamRoomDiscussion(await mappedRun());
  const seq = model.latestParticipantMessage?.sequence ?? null;
  assert.equal(resolveFocusedRole(model, collapseCurrentFocus(seq)), null);
  assert.equal(resolveFocusedRole(model, focusParticipant("reviewer", seq)), "reviewer");
});

test("reply lineage resolves from in_reply_to when parent message is exported", async () => {
  const model = buildTeamRoomDiscussion(await mappedRun());
  const reviewer = model.participants.find((participant) => participant.role === "reviewer");
  assert.equal(reviewer?.lineage?.status, "PROVEN");
  assert.equal(reviewer?.lineage?.replyingToRole, "researcher");
  assert.equal(reviewer?.lineage?.inReplyTo, "M1");
});

test("missing lineage fails closed instead of inventing a parent", async () => {
  const detail = JSON.parse(detailFixture()) as { state: { messages: Array<Record<string, unknown>> } };
  detail.state.messages[1].in_reply_to = "M-UNKNOWN";
  const model = buildTeamRoomDiscussion(await mappedRun(JSON.stringify(detail)));
  const reviewer = model.participants.find((participant) => participant.role === "reviewer");
  assert.equal(reviewer?.lineage?.status, "UNKNOWN_NOT_EXPORTED");
  assert.equal(reviewer?.lineage?.replyingToRole, null);
});

test("messages from roles not present in ACF participants do not fabricate participant cards", async () => {
  const detail = JSON.parse(detailFixture()) as {
    state: { messages: unknown[] };
    events: unknown[];
  };
  detail.state.messages.push({
    message_id: "M9", kind: "NOTE", from: "ghost", to: "OPERATOR", body: "not a participant",
    in_reply_to: null, answered: false, seq: 9,
  });
  detail.events.push({ seq: 9, type: "MESSAGE_POSTED", at: "2026-10-06T20:00:00Z", data: { message_id: "M9" } });
  const model = buildTeamRoomDiscussion(await mappedRun(JSON.stringify(detail)));
  assert.deepEqual(model.participants.map((participant) => participant.role).sort(), ["researcher", "reviewer"]);
  assert.equal(model.participants.some((participant) => participant.role === "ghost"), false);
});

test("mode readiness is truthful: Discuss is read-connected, other shells are prepared only", () => {
  assert.equal(modeDefinition("discuss").readiness, "CONNECTED_READ_ONLY");
  assert.equal(modeDefinition("fusion").readiness, "PREPARED_NOT_CONNECTED");
  assert.equal(modeDefinition("council").readiness, "PREPARED_NOT_CONNECTED");
  assert.equal(modeDefinition("playground").readiness, "PREPARED_NOT_CONNECTED");
});

test("ACF_UNAVAILABLE -> explicit unavailable state", async () => {
  const snapshot = await readAcfTeamRoomSnapshot({
    runner: async () => { throw new Error("acf offline"); },
    now: NOW,
    projectRoot: "/acf",
  });
  assert.equal(snapshot.availability, "unavailable");
  assert.match(snapshot.error ?? "", /acf offline/);
  assert.equal(snapshot.noRealTeamRunYet, false);
});

test("MALFORMED_EXPORT -> fail closed", async () => {
  const snapshot = await readAcfTeamRoomSnapshot({
    runner: runnerFor({ runs: JSON.stringify({ export_version: 1, runs: [{ run_id: "bad" }] }) }),
    now: NOW,
    projectRoot: "/acf",
  });
  assert.equal(snapshot.availability, "malformed");
  assert.match(snapshot.error ?? "", /missing required fields/);
});

test("selected run must exist in canonical runs index", async () => {
  const snapshot = await readAcfTeamRoomSnapshot({
    runner: runnerFor({ runs: indexOne }),
    runId: "UNKNOWN",
    now: NOW,
    projectRoot: "/acf",
  });
  assert.equal(snapshot.availability, "malformed");
  assert.match(snapshot.error ?? "", /not present/);
});

test("STALE_DATA -> last known state is explicitly marked stale", () => {
  const presentation = acfReadPresentation({
    hasLastGood: true,
    lastGoodAt: 1_000,
    now: 20_000,
    staleAfterMs: 15_000,
    refreshFailureKind: null,
  });
  assert.equal(presentation.stale, true);
  assert.equal(presentation.label, "STALE / LAST KNOWN");
});

test("ACF_UNAVAILABLE with last good state keeps an explicit stale label", () => {
  const presentation = acfReadPresentation({
    hasLastGood: true,
    lastGoodAt: 19_000,
    now: 20_000,
    staleAfterMs: 15_000,
    refreshFailureKind: "unavailable",
  });
  assert.equal(presentation.stale, true);
  assert.equal(presentation.label, "STALE / LAST KNOWN");
});

test("initial malformed response fails closed without pretending last-known state exists", () => {
  const presentation = acfReadPresentation({
    hasLastGood: false,
    lastGoodAt: null,
    now: 20_000,
    staleAfterMs: 15_000,
    refreshFailureKind: "malformed",
  });
  assert.equal(presentation.stale, false);
  assert.equal(presentation.label, "MALFORMED / NO STATE");
});


function readinessInput(overrides: Partial<ParticipantReadinessInput> = {}): ParticipantReadinessInput {
  return {
    agentId: "hermes",
    role: "researcher",
    roleClass: "WORKER",
    acfRunPresent: true,
    acfBound: true,
    acfSessionRef: "acf-session-hermes",
    acfReadStale: false,
    blocker: null,
    runtime: {
      exists: true,
      reachable: true,
      stale: false,
      error: null,
      source: "runtime fixture",
      observedAt: 1,
    },
    requiredTransport: null,
    session: {
      sessionRef: "acf-session-hermes",
      exists: true,
      active: true,
      status: "idle",
      stale: false,
      lastError: null,
      source: "session fixture",
      observedAt: 1,
    },
    ...overrides,
  };
}

test("runtime online does not imply ACF connected", () => {
  const readiness = deriveParticipantReadiness(readinessInput({
    acfBound: false,
    acfSessionRef: null,
    session: null,
  }));
  assert.equal(readiness.state, "ACF_NOT_CONNECTED");
  assert.equal(readiness.runtimeReachability, "ONLINE");
  assert.equal(readiness.acfConnection, "NOT_CONNECTED");
});

test("ACF binding with active starting session is connected but not ready", () => {
  const readiness = deriveParticipantReadiness(readinessInput({
    session: {
      sessionRef: "acf-session-hermes",
      exists: true,
      active: true,
      status: "starting",
      stale: false,
      lastError: null,
      source: "session fixture",
      observedAt: 1,
    },
  }));
  assert.equal(readiness.state, "ACF_CONNECTED");
  assert.equal(readiness.acfConnection, "CONNECTED");
  assert.equal(readiness.sessionState, "STARTING");
});

test("proven active idle bound session is READY_IDLE", () => {
  const readiness = deriveParticipantReadiness(readinessInput());
  assert.equal(readiness.state, "READY_IDLE");
  assert.equal(readiness.tone, "ok");
  assert.equal(readiness.sessionState, "IDLE");
});

test("proven active running bound session is WORKING", () => {
  const readiness = deriveParticipantReadiness(readinessInput({
    session: {
      sessionRef: "acf-session-hermes",
      exists: true,
      active: true,
      status: "running",
      stale: false,
      lastError: null,
      source: "session fixture",
      observedAt: 1,
    },
  }));
  assert.equal(readiness.state, "WORKING");
  assert.equal(readiness.tone, "info");
});

test("runtime error never renders as healthy readiness", () => {
  const readiness = deriveParticipantReadiness(readinessInput({
    runtime: {
      exists: true,
      reachable: null,
      stale: false,
      error: "gateway degraded",
      source: "runtime fixture",
      observedAt: 1,
    },
  }));
  assert.equal(readiness.state, "ERROR");
  assert.equal(readiness.tone, "danger");
});

test("bound participant with missing or inactive exact session is ACF_NOT_CONNECTED", () => {
  const missing = deriveParticipantReadiness(readinessInput({
    session: {
      sessionRef: "acf-session-hermes",
      exists: false,
      active: null,
      status: null,
      stale: false,
      lastError: null,
      source: "session fixture",
      observedAt: 1,
    },
  }));
  assert.equal(missing.state, "ACF_NOT_CONNECTED");

  const stopped = deriveParticipantReadiness(readinessInput({
    session: {
      sessionRef: "acf-session-hermes",
      exists: true,
      active: false,
      status: "stopped",
      stale: false,
      lastError: null,
      source: "session fixture",
      observedAt: 1,
    },
  }));
  assert.equal(stopped.state, "ACF_NOT_CONNECTED");
});

test("loss of fresh readiness evidence marks prior state STALE", () => {
  const readiness = deriveParticipantReadiness(readinessInput({
    session: {
      sessionRef: "acf-session-hermes",
      exists: true,
      active: true,
      status: "idle",
      stale: true,
      lastError: null,
      source: "last-known session fixture",
      observedAt: 1,
    },
  }));
  assert.equal(readiness.state, "STALE");
  assert.equal(readiness.tone, "warn");
});

test("missing or contradictory evidence fails closed as UNKNOWN", () => {
  const missing = deriveParticipantReadiness(readinessInput({
    runtime: null,
    session: null,
  }));
  assert.equal(missing.state, "UNKNOWN");

  const contradictory = deriveParticipantReadiness(readinessInput({
    session: {
      sessionRef: "acf-session-hermes",
      exists: true,
      active: false,
      status: "idle",
      stale: false,
      lastError: null,
      source: "contradictory fixture",
      observedAt: 1,
    },
  }));
  assert.equal(contradictory.state, "UNKNOWN");
});

test("required Claude transport must be known and healthy before READY_IDLE", () => {
  const unknown = deriveParticipantReadiness(readinessInput({
    agentId: "claude-code",
    requiredTransport: {
      state: "unknown",
      stale: false,
      detail: "FCC status unavailable",
      source: "fcc fixture",
      observedAt: null,
    },
  }));
  assert.equal(unknown.state, "UNKNOWN");

  const degraded = deriveParticipantReadiness(readinessInput({
    agentId: "claude-code",
    requiredTransport: {
      state: "degraded",
      stale: false,
      detail: "FCC degraded",
      source: "fcc fixture",
      observedAt: 1,
    },
  }));
  assert.equal(degraded.state, "ERROR");

  const disconnected = deriveParticipantReadiness(readinessInput({
    agentId: "claude-code",
    runtime: {
      exists: null,
      reachable: null,
      stale: false,
      error: null,
      source: "claude launcher probe unavailable",
      observedAt: 1,
    },
    requiredTransport: {
      state: "disconnected",
      stale: false,
      detail: "FCC disconnected",
      source: "fcc fixture",
      observedAt: 1,
    },
  }));
  assert.equal(disconnected.state, "ERROR");

  const connected = deriveParticipantReadiness(readinessInput({
    agentId: "claude-code",
    requiredTransport: {
      state: "connected",
      stale: false,
      detail: null,
      source: "fcc fixture",
      observedAt: 1,
    },
  }));
  assert.equal(connected.state, "READY_IDLE");
});

test("ACF role blocker overrides otherwise idle readiness", () => {
  const readiness = deriveParticipantReadiness(readinessInput({ blocker: "WAITING_AUTHORITY" }));
  assert.equal(readiness.state, "BLOCKED");
  assert.equal(readiness.tone, "warn");
});

test("Antigravity is presented as ORCHESTRATOR without claiming activity", () => {
  assert.equal(roleClassForAgent("agy"), "ORCHESTRATOR");
  assert.equal(roleClassForAgent("antigravity"), "ORCHESTRATOR");
  assert.equal(roleClassForAgent("hermes"), "WORKER");

  const readiness = deriveParticipantReadiness(readinessInput({
    agentId: "agy",
    role: "orchestrator",
    roleClass: roleClassForAgent("agy"),
    acfRunPresent: false,
    acfBound: false,
    acfSessionRef: null,
    session: null,
  }));
  assert.equal(readiness.roleClass, "ORCHESTRATOR");
  assert.equal(readiness.state, "RUNTIME_ONLINE");
});

test("known unreachable runtime is RUNTIME_OFFLINE even when stale session history exists", () => {
  const readiness = deriveParticipantReadiness(readinessInput({
    runtime: {
      exists: true,
      reachable: false,
      stale: false,
      error: null,
      source: "runtime fixture",
      observedAt: 1,
    },
    session: {
      sessionRef: "acf-session-hermes",
      exists: true,
      active: false,
      status: "stopped",
      stale: false,
      lastError: null,
      source: "historical session fixture",
      observedAt: 1,
    },
  }));
  assert.equal(readiness.state, "RUNTIME_OFFLINE");
});
