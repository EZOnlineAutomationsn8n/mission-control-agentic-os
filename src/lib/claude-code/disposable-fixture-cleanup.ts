// Development-only, internal guard. No API route, database mutation or native transcript deletion.
import type { ClaudeCodeSession } from "./session-store";

export interface DisposableFixtureOwnership {
  kind: "mission-control-claude-disposable-cert-v1";
  owner: "DENNIS";
  project: "MISSION_CONTROL_AGENTIC_OS";
  originatingOrderId: string;
  fixtureId: string;
  sessionKey: string;
  nativeSessionId: string;
  createdAt: string;
}

export interface FixtureCleanupRequest {
  ownership: DisposableFixtureOwnership;
  sessionKey: string;
  nativeSessionId: string;
  originatingOrderId: string;
  fixtureId: string;
  owner: "DENNIS";
}

export type FixtureCleanupDecision =
  | { allowed: true; action: "RETAIN_STOPPED_FIXTURE_WITH_AUDIT" }
  | { allowed: false; reason: string };

/**
 * The ownership marker must have been durably attached to the session
 * AT FIXTURE CREATION. Existing historical records have no such marker.
 * Unknown storage, in-flight status and missing independent proof fail closed.
 */
export function authorizeDisposableClaudeCleanup(input: {
  session: (ClaudeCodeSession & { disposableFixture?: DisposableFixtureOwnership }) | null;
  request: FixtureCleanupRequest;
  storageVerified: boolean;
  noInFlightWorkVerified: boolean;
  auditReady: boolean;
  nativeTranscriptPreservationVerified: boolean;
}): FixtureCleanupDecision {
  const deny = (reason: string): FixtureCleanupDecision => ({ allowed: false, reason });
  const { session, request, storageVerified, noInFlightWorkVerified, auditReady, nativeTranscriptPreservationVerified } = input;
  if (!storageVerified) return deny("STORAGE_UNVERIFIED");
  if (!session) return deny("UNKNOWN_SESSION");
  if (!auditReady) return deny("AUDIT_UNAVAILABLE");
  if (!nativeTranscriptPreservationVerified) return deny("NATIVE_TRANSCRIPT_PRESERVATION_UNVERIFIED");
  if (!noInFlightWorkVerified || session.active || ["starting", "running", "idle"].includes(session.status)) return deny("ACTIVE_OR_IN_FLIGHT");
  if (session.status !== "stopped") return deny("NOT_VERIFIED_STOPPED");
  const o = session.disposableFixture;
  if (!o || o.kind !== "mission-control-claude-disposable-cert-v1") return deny("NOT_REGISTERED_FIXTURE");
  if (o.owner !== "DENNIS" || o.project !== "MISSION_CONTROL_AGENTIC_OS" || request.owner !== o.owner) return deny("OWNER_MISMATCH");
  if (!o.originatingOrderId || !o.fixtureId || !o.createdAt || !o.nativeSessionId) return deny("INCOMPLETE_FIXTURE_PROVENANCE");
  if (o.originatingOrderId !== request.originatingOrderId || o.fixtureId !== request.fixtureId) return deny("ORDER_OR_FIXTURE_MISMATCH");
  if (o.sessionKey !== session.sessionKey || o.sessionKey !== request.sessionKey) return deny("SESSION_KEY_MISMATCH");
  if (o.nativeSessionId !== session.claudeSessionId || o.nativeSessionId !== request.nativeSessionId) return deny("NATIVE_ID_MISMATCH");
  if (o.createdAt !== session.createdAt) return deny("CREATION_PROVENANCE_MISMATCH");
  return { allowed: true, action: "RETAIN_STOPPED_FIXTURE_WITH_AUDIT" };
}
