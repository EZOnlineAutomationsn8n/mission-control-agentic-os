import { canonicalSha256, type CanonicalJsonValue } from "@/lib/determinism/canonicalize";
import type { DeterministicExecutionEnvelope } from "@/lib/determinism/execution-envelope";

export type ExecutionResult = "ACCEPTED" | "BLOCKED" | "FAILED";
export interface DeterministicExecutionReceipt {
  requestFingerprint: string;
  replayIdentity: string;
  effectIdentity: string | null;
  projectId: string;
  actionKind: string;
  sourceBindingHash: string | null;
  baseStateVersion: string;
  executionContractVersion: string;
  versionStateFingerprint: string;
  result: ExecutionResult;
  failureReason: string | null;
  tracePrevHash: string | null;
  tracePayloadHash: string;
  traceCurrentHash: string;
  verifierVersion: string;
  correlationId: string;
  recordedAt: string;
}

function receiptPayload(envelope: DeterministicExecutionEnvelope, result: ExecutionResult, failureReason: string | null): CanonicalJsonValue {
  return {
    requestFingerprint: envelope.requestFingerprint, replayIdentity: envelope.replayIdentity,
    effectIdentity: envelope.effectIdentity, projectId: envelope.projectId, actionKind: envelope.actionKind,
    sourceBindingHash: envelope.sourceBindingHash, baseStateVersion: envelope.baseStateVersion,
    executionContractVersion: envelope.executionContractVersion, versionStateFingerprint: envelope.versionStateFingerprint,
    result, failureReason,
  } as CanonicalJsonValue;
}

export function createExecutionReceipt(input: {
  envelope: DeterministicExecutionEnvelope;
  result: ExecutionResult;
  failureReason?: string | null;
  previousReceipt?: DeterministicExecutionReceipt | null;
  verifierVersion?: string;
}): DeterministicExecutionReceipt {
  const failureReason = input.failureReason ?? null;
  const verifierVersion = input.verifierVersion ?? "mc-trace-receipt-v1";
  const tracePrevHash = input.previousReceipt?.traceCurrentHash ?? null;
  const tracePayloadHash = canonicalSha256(receiptPayload(input.envelope, input.result, failureReason));
  const traceCurrentHash = canonicalSha256({ tracePrevHash, tracePayloadHash, verifierVersion } as CanonicalJsonValue);
  return {
    requestFingerprint: input.envelope.requestFingerprint, replayIdentity: input.envelope.replayIdentity,
    effectIdentity: input.envelope.effectIdentity, projectId: input.envelope.projectId, actionKind: input.envelope.actionKind,
    sourceBindingHash: input.envelope.sourceBindingHash, baseStateVersion: input.envelope.baseStateVersion,
    executionContractVersion: input.envelope.executionContractVersion, versionStateFingerprint: input.envelope.versionStateFingerprint,
    result: input.result, failureReason, tracePrevHash, tracePayloadHash, traceCurrentHash, verifierVersion,
    correlationId: input.envelope.correlationId, recordedAt: input.envelope.recordedAt,
  };
}

export function verifyReceiptChain(receipts: DeterministicExecutionReceipt[]): { valid: boolean; failureReason: "TRACE_CHAIN_MISMATCH" | null; index: number | null } {
  let previous: string | null = null;
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    const payload = {
      requestFingerprint: receipt.requestFingerprint, replayIdentity: receipt.replayIdentity,
      effectIdentity: receipt.effectIdentity, projectId: receipt.projectId, actionKind: receipt.actionKind,
      sourceBindingHash: receipt.sourceBindingHash, baseStateVersion: receipt.baseStateVersion,
      executionContractVersion: receipt.executionContractVersion, versionStateFingerprint: receipt.versionStateFingerprint,
      result: receipt.result, failureReason: receipt.failureReason,
    } as CanonicalJsonValue;
    const expectedPayloadHash = canonicalSha256(payload);
    const expectedCurrentHash = canonicalSha256({ tracePrevHash: previous, tracePayloadHash: expectedPayloadHash, verifierVersion: receipt.verifierVersion } as CanonicalJsonValue);
    if (receipt.tracePrevHash !== previous || receipt.tracePayloadHash !== expectedPayloadHash || receipt.traceCurrentHash !== expectedCurrentHash) {
      return { valid: false, failureReason: "TRACE_CHAIN_MISMATCH", index };
    }
    previous = receipt.traceCurrentHash;
  }
  return { valid: true, failureReason: null, index: null };
}

export function detectDuplicateEffect(candidate: DeterministicExecutionEnvelope, receipts: DeterministicExecutionReceipt[]): "DUPLICATE_EFFECT_ATTEMPT" | null {
  if (!candidate.effectIdentity) return null;
  return receipts.some((receipt) => receipt.result === "ACCEPTED" && receipt.effectIdentity === candidate.effectIdentity)
    ? "DUPLICATE_EFFECT_ATTEMPT" : null;
}
