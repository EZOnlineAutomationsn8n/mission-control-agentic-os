export type ParticipantOperationalState =
  | "RUNTIME_OFFLINE"
  | "RUNTIME_ONLINE"
  | "ACF_NOT_CONNECTED"
  | "ACF_CONNECTED"
  | "READY_IDLE"
  | "WORKING"
  | "BLOCKED"
  | "ERROR"
  | "STALE"
  | "UNKNOWN";

export type ParticipantRoleClass = "WORKER" | "ORCHESTRATOR";

export type SessionOperationalStatus = "starting" | "idle" | "running" | "stopped" | "error";

export interface RuntimeReadinessObservation {
  exists: boolean | null;
  reachable: boolean | null;
  stale: boolean;
  error: string | null;
  source: string;
  observedAt: number | null;
}

export interface DependencyReadinessObservation {
  state: "connected" | "degraded" | "disconnected" | "unknown";
  stale: boolean;
  detail: string | null;
  source: string;
  observedAt: number | null;
}

export interface SessionReadinessObservation {
  sessionRef: string;
  exists: boolean | null;
  active: boolean | null;
  status: SessionOperationalStatus | null;
  stale: boolean;
  lastError: string | null;
  source: string;
  observedAt: number | null;
}

export interface ParticipantReadinessInput {
  agentId: string | null;
  role: string;
  roleClass: ParticipantRoleClass;
  acfRunPresent: boolean;
  acfBound: boolean;
  acfSessionRef: string | null;
  acfReadStale: boolean;
  blocker: string | null;
  runtime: RuntimeReadinessObservation | null;
  requiredTransport?: DependencyReadinessObservation | null;
  session: SessionReadinessObservation | null;
}

export interface ParticipantReadinessResult {
  state: ParticipantOperationalState;
  label: string;
  tone: "ok" | "info" | "warn" | "danger" | "muted";
  explanation: string;
  roleClass: ParticipantRoleClass;
  runtimeExistence: "EXISTS" | "NOT_PROVEN" | "MISSING";
  runtimeReachability: "ONLINE" | "OFFLINE" | "UNKNOWN";
  acfConnection: "CONNECTED" | "NOT_CONNECTED" | "NOT_APPLICABLE" | "UNKNOWN";
  sessionState: "IDLE" | "WORKING" | "STARTING" | "STOPPED" | "ERROR" | "MISSING" | "UNKNOWN";
  transportState: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNKNOWN" | "NOT_APPLICABLE";
  sources: string[];
}

const LABELS: Record<ParticipantOperationalState, string> = {
  RUNTIME_OFFLINE: "Runtime offline",
  RUNTIME_ONLINE: "Runtime online",
  ACF_NOT_CONNECTED: "ACF not connected",
  ACF_CONNECTED: "ACF connected",
  READY_IDLE: "Ready · waiting",
  WORKING: "Working",
  BLOCKED: "Blocked",
  ERROR: "Error",
  STALE: "Stale",
  UNKNOWN: "Unknown",
};

const TONES: Record<ParticipantOperationalState, ParticipantReadinessResult["tone"]> = {
  RUNTIME_OFFLINE: "danger",
  RUNTIME_ONLINE: "info",
  ACF_NOT_CONNECTED: "muted",
  ACF_CONNECTED: "info",
  READY_IDLE: "ok",
  WORKING: "info",
  BLOCKED: "warn",
  ERROR: "danger",
  STALE: "warn",
  UNKNOWN: "muted",
};

function sessionState(session: SessionReadinessObservation | null): ParticipantReadinessResult["sessionState"] {
  if (!session || session.exists === null) return "UNKNOWN";
  if (session.exists === false) return "MISSING";
  if (session.status === "idle") return "IDLE";
  if (session.status === "running") return "WORKING";
  if (session.status === "starting") return "STARTING";
  if (session.status === "stopped") return "STOPPED";
  if (session.status === "error") return "ERROR";
  return "UNKNOWN";
}

function transportState(
  dependency: DependencyReadinessObservation | null | undefined
): ParticipantReadinessResult["transportState"] {
  if (!dependency) return "NOT_APPLICABLE";
  if (dependency.state === "connected") return "CONNECTED";
  if (dependency.state === "degraded") return "DEGRADED";
  if (dependency.state === "disconnected") return "DISCONNECTED";
  return "UNKNOWN";
}

function contradiction(input: ParticipantReadinessInput): string | null {
  const session = input.session;
  if (session?.exists === true) {
    if (session.active === false && (session.status === "idle" || session.status === "running" || session.status === "starting")) {
      return `session ${session.sessionRef} is inactive but reports ${session.status}`;
    }
    if (session.active === true && session.status === "stopped") {
      return `session ${session.sessionRef} is active but reports stopped`;
    }
  }
  if (input.runtime?.reachable === false && session?.exists === true && session.active === true && session.status === "running") {
    return "runtime is reported offline while the bound session reports running";
  }
  return null;
}

function explanationFor(
  state: ParticipantOperationalState,
  input: ParticipantReadinessInput,
  conflict: string | null
): string {
  const session = input.session;
  switch (state) {
    case "RUNTIME_OFFLINE":
      return "The runtime is known but current reachability evidence says it is offline.";
    case "RUNTIME_ONLINE":
      return "The runtime is currently reachable; no ACF participant connection is being claimed.";
    case "ACF_NOT_CONNECTED":
      if (!input.acfBound) return "The runtime is reachable, but ACF has no complete participant binding for this agent.";
      if (!session || session.exists === null) return "ACF has a binding, but the bound Mission Control session cannot currently be proven.";
      if (session.exists === false) return `ACF is bound to ${input.acfSessionRef}, but that Mission Control session does not exist.`;
      return `ACF is bound to ${input.acfSessionRef}, but that session is not active/connected.`;
    case "ACF_CONNECTED":
      return `ACF binding and session ${input.acfSessionRef ?? "UNKNOWN"} are present, but the session is not yet proven ready-idle.`;
    case "READY_IDLE":
      return `Runtime reachable; ACF binding present; session ${input.acfSessionRef} is active and currently reports idle.`;
    case "WORKING":
      return `The ACF-bound session ${input.acfSessionRef} currently reports running.`;
    case "BLOCKED":
      return input.blocker ? `ACF work for this role is blocked: ${input.blocker}` : "The participant is blocked by current ACF state.";
    case "ERROR":
      return session?.lastError || input.runtime?.error || input.requiredTransport?.detail || "Current operational evidence reports an error.";
    case "STALE":
      return "Last-known evidence exists, but one or more required readiness reads are no longer fresh.";
    case "UNKNOWN":
      return conflict ? `Contradictory evidence: ${conflict}` : "Current evidence is insufficient to determine readiness safely.";
  }
}

export function deriveParticipantReadiness(input: ParticipantReadinessInput): ParticipantReadinessResult {
  const runtimeExistence =
    input.runtime?.exists === true ? "EXISTS" :
    input.runtime?.exists === false ? "MISSING" :
    "NOT_PROVEN";
  const runtimeReachability =
    input.runtime?.reachable === true ? "ONLINE" :
    input.runtime?.reachable === false ? "OFFLINE" :
    "UNKNOWN";
  const session = sessionState(input.session);
  const transport = transportState(input.requiredTransport);
  const sources = [
    input.runtime?.source,
    input.requiredTransport?.source,
    input.session?.source,
    input.acfRunPresent ? "ACF export-run participant binding" : null,
  ].filter((value): value is string => Boolean(value));

  const conflict = contradiction(input);
  let state: ParticipantOperationalState;

  if (conflict) {
    state = "UNKNOWN";
  } else if (input.session?.stale || input.runtime?.stale || input.requiredTransport?.stale || input.acfReadStale) {
    state = "STALE";
  } else if (input.session?.status === "error" || input.runtime?.error || input.requiredTransport?.state === "degraded") {
    state = "ERROR";
  } else if (input.runtime?.reachable === false || input.runtime?.exists === false) {
    state = "RUNTIME_OFFLINE";
  } else if (input.requiredTransport?.state === "disconnected") {
    state = "ERROR";
  } else if (input.runtime?.reachable !== true) {
    state = "UNKNOWN";
  } else if (input.requiredTransport?.state === "unknown") {
    state = "UNKNOWN";
  } else if (!input.acfRunPresent) {
    state = "RUNTIME_ONLINE";
  } else if (!input.acfBound || !input.acfSessionRef) {
    state = "ACF_NOT_CONNECTED";
  } else if (!input.session || input.session.exists === null) {
    state = "UNKNOWN";
  } else if (input.session.exists === false || input.session.active !== true || input.session.status === "stopped") {
    state = "ACF_NOT_CONNECTED";
  } else if (input.blocker) {
    state = "BLOCKED";
  } else if (input.session.status === "running") {
    state = "WORKING";
  } else if (input.session.status === "starting") {
    state = "ACF_CONNECTED";
  } else if (input.session.status === "idle") {
    state = "READY_IDLE";
  } else {
    state = "ACF_CONNECTED";
  }

  const acfConnection: ParticipantReadinessResult["acfConnection"] =
    !input.acfRunPresent ? "NOT_APPLICABLE" :
    !input.acfBound || !input.acfSessionRef ? "NOT_CONNECTED" :
    state === "ACF_NOT_CONNECTED" ? "NOT_CONNECTED" :
    input.session?.exists === true && input.session.active === true ? "CONNECTED" :
    state === "STALE" ? "UNKNOWN" :
    "UNKNOWN";

  return {
    state,
    label: LABELS[state],
    tone: TONES[state],
    explanation: explanationFor(state, input, conflict),
    roleClass: input.roleClass,
    runtimeExistence,
    runtimeReachability,
    acfConnection,
    sessionState: session,
    transportState: transport,
    sources,
  };
}

export function roleClassForAgent(agentId: string | null): ParticipantRoleClass {
  return agentId === "agy" || agentId === "antigravity" ? "ORCHESTRATOR" : "WORKER";
}
