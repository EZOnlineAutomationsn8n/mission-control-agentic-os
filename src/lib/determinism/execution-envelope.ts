import { randomUUID } from "node:crypto";
import type { SourceBindingProof } from "@/lib/source-binding/types";
import { canonicalSha256, NORMALIZATION_VERSION, type CanonicalJsonValue } from "@/lib/determinism/canonicalize";

export type EffectClass = "READ_ONLY" | "REVERSIBLE_WRITE" | "EXTERNAL_WRITE" | "DESTRUCTIVE" | "PROMOTION";
export type ReplayFailure = "REQUEST_FINGERPRINT_MISMATCH" | "SOURCE_BINDING_CHANGED" | "BASE_STATE_CHANGED" | "EXECUTION_CONTRACT_CHANGED" | "REPLAY_WORLD_DRIFT";

export interface DeterministicExecutionEnvelope {
  requestFingerprint: string;
  normalizationVersion: string;
  projectId: string;
  actionKind: string;
  sourceBindingId: string | null;
  sourceBindingHash: string | null;
  idempotencyKey: string | null;
  baseStateVersion: string;
  executionContractVersion: string;
  governedVersions: Record<string, string>;
  versionStateFingerprint: string;
  replayIdentity: string;
  effectClass: EffectClass;
  effectIdentity: string | null;
  correlationId: string;
  recordedAt: string;
}

export interface BuildExecutionEnvelopeInput {
  semanticRequest: CanonicalJsonValue;
  projectId: string;
  actionKind: string;
  sourceBinding?: SourceBindingProof | null;
  idempotencyKey?: string | null;
  baseStateVersion: string;
  executionContractVersion: string;
  governedVersions?: Record<string, string>;
  effectClass: EffectClass;
  correlationId?: string;
  recordedAt?: string;
  normalizationVersion?: string;
}

export function fingerprintSourceBinding(proof: SourceBindingProof): string {
  return canonicalSha256({
    projectId: proof.projectId, requestedObject: proof.requestedObject, requestedAction: proof.requestedAction,
    resolvedCanonicalObject: proof.resolvedCanonicalObject, sourceKind: proof.sourceKind,
    authoritySource: proof.authoritySource, authorityClass: proof.authorityClass, sourceVersion: proof.sourceVersion,
    resolutionProof: [...proof.resolutionProof].sort(), aliasStatus: proof.aliasStatus, shadowStatus: proof.shadowStatus,
    staleStatus: proof.staleStatus, projectScopeStatus: proof.projectScopeStatus,
    provenanceStatus: proof.provenanceStatus, mutationAllowed: proof.mutationAllowed, failureReason: proof.failureReason,
  } as CanonicalJsonValue);
}

export function buildExecutionEnvelope(input: BuildExecutionEnvelopeInput): DeterministicExecutionEnvelope {
  const normalizationVersion = input.normalizationVersion ?? NORMALIZATION_VERSION;
  const requestFingerprint = canonicalSha256(input.semanticRequest, normalizationVersion);
  const sourceBindingHash = input.sourceBinding ? fingerprintSourceBinding(input.sourceBinding) : null;
  const governedVersions = input.governedVersions ?? {};
  const versionStateFingerprint = canonicalSha256({
    baseStateVersion: input.baseStateVersion, sourceBindingHash,
    executionContractVersion: input.executionContractVersion, governedVersions,
  } as CanonicalJsonValue, normalizationVersion);
  const replayIdentity = canonicalSha256({ projectId: input.projectId, actionKind: input.actionKind, requestFingerprint, versionStateFingerprint } as CanonicalJsonValue, normalizationVersion);
  const idempotencyKey = input.idempotencyKey ?? null;
  const effectIdentity = idempotencyKey ? canonicalSha256({ projectId: input.projectId, actionKind: input.actionKind, idempotencyKey } as CanonicalJsonValue, normalizationVersion) : null;
  return {
    requestFingerprint, normalizationVersion, projectId: input.projectId, actionKind: input.actionKind,
    sourceBindingId: input.sourceBinding?.sourceBindingId ?? null, sourceBindingHash, idempotencyKey,
    baseStateVersion: input.baseStateVersion, executionContractVersion: input.executionContractVersion,
    governedVersions, versionStateFingerprint, replayIdentity, effectClass: input.effectClass, effectIdentity,
    correlationId: input.correlationId ?? randomUUID(), recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
}

export function compareReplay(previous: DeterministicExecutionEnvelope, next: DeterministicExecutionEnvelope): ReplayFailure | null {
  if (previous.requestFingerprint !== next.requestFingerprint) return "REQUEST_FINGERPRINT_MISMATCH";
  if (previous.sourceBindingHash !== next.sourceBindingHash) return "SOURCE_BINDING_CHANGED";
  if (previous.baseStateVersion !== next.baseStateVersion) return "BASE_STATE_CHANGED";
  if (previous.executionContractVersion !== next.executionContractVersion) return "EXECUTION_CONTRACT_CHANGED";
  if (previous.versionStateFingerprint !== next.versionStateFingerprint) return "REPLAY_WORLD_DRIFT";
  return null;
}
