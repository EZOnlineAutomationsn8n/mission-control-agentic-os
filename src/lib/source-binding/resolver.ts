import { createHash } from "node:crypto";
import { validateSystemObject } from "@/lib/system-register/validate";
import type { SystemObjectRecord } from "@/lib/system-register/types";
import type { SourceBindingCandidate, SourceBindingFailure, SourceBindingProof, SourceBindingRequest, SourceBindingResolution } from "@/lib/source-binding/types";

const isMutation = (action: SourceBindingRequest["requestedAction"]) => action !== "READ";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function failure(request: SourceBindingRequest, reason: SourceBindingFailure, evidence: string[] = []): SourceBindingResolution {
  const boundAt = request.boundAt ?? new Date().toISOString();
  const sourceBindingId = `sb-${sha([request.projectId, request.requestedObject, request.requestedAction, reason, ...evidence].join("\n"))}`;
  return { ok: false, proof: {
    sourceBindingId, projectId: request.projectId, requestedObject: request.requestedObject,
    requestedAction: request.requestedAction, resolvedCanonicalObject: null, sourceKind: null,
    authoritySource: null, authorityClass: null, sourceVersion: null, resolutionProof: evidence,
    aliasStatus: reason === "ALIAS_ONLY" ? "ALIAS_ONLY_CONFLICT" : "NONE",
    shadowStatus: reason === "SHADOW_TARGET" ? "SHADOW_DETECTED" : "NONE",
    staleStatus: reason === "STALE_VERSION" ? "STALE" : "UNKNOWN",
    projectScopeStatus: reason === "PROJECT_SCOPE_CONFLICT" ? "CONFLICT" : "UNKNOWN",
    provenanceStatus: reason === "UNRESOLVED_PROVENANCE" ? "UNKNOWN" : reason === "AUTHORITY_CONFLICT" ? "CONFLICT" : "UNKNOWN",
    mutationAllowed: false, boundAt, boundBy: request.boundBy, failureReason: reason,
  }};
}

function matches(candidate: SourceBindingCandidate, requested: string): boolean {
  return candidate.object.objectId === requested || candidate.object.locator === requested;
}

function currentnessFailure(object: SystemObjectRecord): SourceBindingFailure | null {
  if (object.currentness === "DUPLICATE") return "SHADOW_TARGET";
  if (object.currentness === "PREDECESSOR" || object.currentness === "ARCHIVE") return "STALE_VERSION";
  if (object.currentness === "CANDIDATE" || object.currentness === "UNKNOWN") return "UNRESOLVED_PROVENANCE";
  return null;
}

export function resolveSourceBinding(request: SourceBindingRequest, candidates: SourceBindingCandidate[]): SourceBindingResolution {
  const direct = candidates.filter((candidate) => matches(candidate, request.requestedObject));
  if (direct.length === 0) return failure(request, "SOURCE_NOT_FOUND");
  const projectMatches = direct.filter((candidate) => candidate.object.projectId === request.projectId && candidate.object.scope.projectId === request.projectId);
  if (projectMatches.length === 0) return failure(request, "PROJECT_SCOPE_CONFLICT", direct.map((c) => c.object.objectId));

  const aliasOnly = projectMatches.filter((candidate) => candidate.aliasTargetObjectId && !candidates.some((other) => other.object.objectId === candidate.aliasTargetObjectId));
  if (aliasOnly.length === projectMatches.length && aliasOnly.length > 0) return failure(request, "ALIAS_ONLY", aliasOnly.map((c) => c.object.objectId));

  const usable = projectMatches.filter((candidate) => !candidate.aliasTargetObjectId);
  if (usable.length > 1) return failure(request, "MULTIPLE_CANONICAL_CANDIDATES", usable.map((c) => c.object.objectId));
  const candidate = usable[0] ?? projectMatches[0];
  if (!candidate) return failure(request, "SOURCE_NOT_FOUND");
  const validation = validateSystemObject(candidate.object);
  if (!validation.valid) return failure(request, validation.errors.includes("PROJECT_SCOPE_CONFLICT") ? "PROJECT_SCOPE_CONFLICT" : "UNRESOLVED_PROVENANCE", validation.errors);
  const currentnessFailureReason = currentnessFailure(candidate.object);
  if (currentnessFailureReason) return failure(request, currentnessFailureReason, candidate.object.evidenceRefs);
  if (candidate.provenanceStatus === "CONFLICT" || candidate.provenanceStatus === "UNKNOWN") return failure(request, "UNRESOLVED_PROVENANCE", candidate.object.evidenceRefs);
  if (candidate.object.evidenceState !== "PROVEN" || !candidate.object.contentHashOrVersion) return failure(request, "UNRESOLVED_PROVENANCE", candidate.object.evidenceRefs);
  if (candidate.object.authorityOwner !== request.authorityOwner) return failure(request, "AUTHORITY_CONFLICT", candidate.object.evidenceRefs);
  if (request.requiredAuthorityClass && candidate.object.authorityClass !== request.requiredAuthorityClass) return failure(request, "AUTHORITY_CONFLICT", candidate.object.evidenceRefs);
  if (isMutation(request.requestedAction) && candidate.object.currentness === "DERIVED") return failure(request, "STALE_VERSION", candidate.object.evidenceRefs);
  if (isMutation(request.requestedAction) && candidate.object.authorityClass !== "OPERATOR_ACCEPTED") return failure(request, "AUTHORITY_CONFLICT", candidate.object.evidenceRefs);

  const boundAt = request.boundAt ?? new Date().toISOString();
  const aliasStatus = candidate.aliasTargetObjectId ? "RESOLVED_TO_CANONICAL" as const : "NONE" as const;
  const facts = [request.projectId, request.requestedObject, request.requestedAction, candidate.object.objectId, candidate.object.contentHashOrVersion, candidate.object.authorityClass, candidate.object.currentness];
  const proof: SourceBindingProof = {
    sourceBindingId: `sb-${sha(facts.join("\n"))}`, projectId: request.projectId,
    requestedObject: request.requestedObject, requestedAction: request.requestedAction,
    resolvedCanonicalObject: candidate.object.objectId, sourceKind: candidate.object.objectKind,
    authoritySource: candidate.object.authorityOwner, authorityClass: candidate.object.authorityClass,
    sourceVersion: candidate.object.contentHashOrVersion, resolutionProof: [...candidate.object.evidenceRefs],
    aliasStatus, shadowStatus: "NONE", staleStatus: candidate.object.currentness === "CURRENT" ? "CURRENT" : "UNKNOWN",
    projectScopeStatus: "MATCH", provenanceStatus: "RESOLVED",
    mutationAllowed: isMutation(request.requestedAction) ? candidate.object.authorityClass === "OPERATOR_ACCEPTED" && candidate.object.currentness === "CURRENT" : true,
    boundAt, boundBy: request.boundBy, failureReason: null,
  };
  return { ok: true, proof };
}
