export type AcfIdentityVerificationState = "VERIFIED" | "CLAIMED" | "UNKNOWN";

export type AcfReadAvailability = "available" | "empty" | "unavailable" | "malformed";

export interface AcfRunSummary {
  runId: string;
  goal: string;
  project: string;
  runState: string;
  lastSequence: number;
  stateHash: string;
  leaseHolder: string | null;
  leaseEpoch: number;
  orchestratorAdapter: string | null;
  orchestratorIdentityVerification: AcfIdentityVerificationState;
  taskCounts: Record<string, number>;
}

export interface AcfTaskReadModel {
  taskId: string;
  title: string;
  role: string | null;
  taskState: string;
  dependsOn: string[];
  iteration: number | null;
  maxIterations: number | null;
  needsDecisionReason: string | null;
  reviewOf: string | null;
  reviewVerdict: string | null;
}

export interface AcfParticipantReadModel {
  role: string;
  participantId: string | null;
  agentId: string | null;
  sessionRef: string | null;
  identityVerificationState: AcfIdentityVerificationState;
}

export interface AcfMessageOriginReadModel {
  via: string | null;
  turnId: string | null;
  participantId: string | null;
  agentId: string | null;
  sessionRef: string | null;
  contextThroughSequence: number | null;
  basedOnSequence: number | null;
  conversationRef: string | null;
  responseSha256: string | null;
}

export interface AcfMessageReadModel {
  messageId: string;
  kind: "NOTE" | "QUESTION" | "ANSWER";
  from: string;
  to: string;
  body: string;
  inReplyTo: string | null;
  answered: boolean;
  sequence: number;
  at: string | null;
  origin: AcfMessageOriginReadModel | null;
}

export interface AcfProofPointer {
  kind: "state_hash" | "recorded_state_hash" | "execution_reference";
  value: string;
}

export interface AcfTeamViewV1 {
  view_version: 1;
  /** ACF D8 is additive to view_version=1; absent/null for all historical v1 runs. */
  schema?: 2 | null;
  tasks?: Array<{ task_id: string; assignee: string; reviewer?: string | null; title?: string | null; status: string }>;
  due?: Array<{ task_id: string; role: string }>;
  run_id: string;
  run_status: string;
  team_run_completed: boolean;
  state_hash: string;
  last_seq: number;
  replay_matches_record: boolean | null;
  next_safe_action: string | null;
  reentry_point: Record<string, unknown> | null;
  participants: Array<{role?: string;agent_id?: string;session_ref?: string;loop_role?: string|null;identity?: string;tags?: string[]}>;
  turns: Array<{seq?:number;role?:string;outcome?:string;message_id?:string|null;decision_id?:string|null;agent_id?:string|null;session_ref?:string|null;conversation_ref?:string|null}>;
  in_flight: unknown | null;
  loop: Record<string, unknown> | null;
  acceptance: Record<string, unknown> | null;
  completion: Record<string, unknown>;
  // ACF-OPERATOR-INTERVENTION-LOOP-001 additions (view_version stays 1; contract §11). Optional: older homes lack them.
  autonomy?: "AUTONOMOUS" | "OPERATOR_INTERVENTION" | "PAUSED" | string;
  intervention?: AcfInterventionView;
  directed_turns?: AcfDirectedTurn[];
  directed_steps?: number;
  lineage?: AcfLineage | null;
  steps?: { used: number; max: number | null; open: number[] };
  /** ACF §14 FreeRoom window; status and budget are owned by ACF. */
  collaboration?: { window_id: string; order: string[]; rounds: number; posted: number; total: number;
    status: "OPEN" | "RUNNING" | "ENDED" | "BLOCKED" | string; reason?: string | null; messages?: unknown[];
    open_pending?: Array<{turn_id:string;role:string;status?:string}>;
    pending?: Array<{turn_id:string;role:string;status?:string}>; } | null;
  consensus?: {status:"CONSENSUS_REACHED" | "NOT_REACHED" | string; consensus_id?:string;
    answers?: Record<string,string>} | null;
}

/** One operator message said during an intervention (posting.intervention_messages + its text). */
export interface AcfInterventionMessage {
  message_id: string;
  seq: number;
  kind: "QUESTION" | "NOTE" | string;
  to: string;
  body_sha256?: string;
  intervention_id: string;
  audience: "ROLE" | "SELECTED" | "TEAM" | "ORCHESTRATOR" | string;
  reply_requested: boolean;
  group: string;
  purpose: "COMMUNICATE" | "ADJUST" | string;
  text: string | null;
}

/** A directed (operator-requested) participant turn: POSTED, or a refusal outcome with code/detail. */
export interface AcfDirectedTurn {
  seq: number;
  outcome: string;
  message_id?: string | null;
  role: string | null;
  to?: string | null;
  kind?: string | null;
  in_reply_to?: string | null;
  intervention_id: string | null;
  operator_message_id: string | null;
  turn_id?: string | null;
  agent_id?: string | null;
  session_ref?: string | null;
  conversation_ref?: string | null;
  code?: string | null;
  prompt_given?: string | null;
  detail?: string | null;
}

export interface AcfInterventionWindow {
  intervention_id: string;
  opened_seq: number;
  opened_at: string | null;
  by_claim: string | null;
  reason: string;
  closed_seq?: number | null;
  closed_at?: string | null;
  closed_by_claim?: string | null;
  closed_by?: string | null;
  messages: AcfInterventionMessage[];
  replies: AcfDirectedTurn[];
  orchestrator_answers: Array<{ message_id: string; seq: number; in_reply_to: string | null }>;
  owed?: Array<{ message_id: string; to: string }>;
}

export interface AcfInterventionView {
  open: AcfInterventionWindow | null;
  count: number;
  history: AcfInterventionWindow[];
}

export interface AcfLineage {
  predecessor: { run_id: string; loop_status?: string | null; base_message_id?: string | null; accepted_review?: string | null } | null;
  successors: Array<{ run_id: string } | string>;
}

export interface AcfTeamRoomRun {
  runId: string;
  goal: string;
  project: string;
  runState: string;
  teamView: AcfTeamViewV1 | null;
  taskState: AcfTaskReadModel[];
  leaseHolder: string | null;
  leaseEpoch: number;
  orchestratorAdapter: string | null;
  orchestratorIdentityVerification: AcfIdentityVerificationState;
  participants: AcfParticipantReadModel[];
  messages: AcfMessageReadModel[];
  blocker: string | null;
  blockerEvidenceState: AcfIdentityVerificationState;
  reentryPoint: string | null;
  nextSafeAction: string | null;
  proofPointers: AcfProofPointer[];
  lastEventOrSequence: {
    sequence: number;
    type: string | null;
    at: string | null;
  };
  stateHash: string;
  replayMatchesRecord: boolean | null;
}

export interface AcfTeamRoomSnapshot {
  availability: AcfReadAvailability;
  observedAt: string;
  source: {
    projectRoot: string;
    stateDir: string | null;
    sourceConfigured: boolean;
    commandSurface: "./acf runs + ./acf export-run + ./acf team-view";
    readOnly: true;
    provenanceClass: "CERTIFIED_HISTORICAL_READ_SNAPSHOT" | "CONFIGURED_ACF_SOURCE_UNVERIFIED";
  };
  runs: AcfRunSummary[];
  selectedRun: AcfTeamRoomRun | null;
  noRealTeamRunYet: boolean;
  error: string | null;
}

export interface AcfIndexExport {
  export_version: number;
  runs: unknown[];
}

export interface AcfRunExport {
  export_version: number;
  run_id: string;
  last_seq: number;
  state_hash: string;
  recorded_state_hash?: string;
  replay_matches_record?: boolean;
  state: Record<string, unknown>;
  events?: unknown[];
}
