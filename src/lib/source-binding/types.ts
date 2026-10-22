import type { SystemAuthorityClass, SystemObjectRecord } from "@/lib/system-register/types";

export type SourceBindingAction = "READ" | "WRITE" | "EXECUTE" | "PROMOTE" | "DELETE";
export type SourceBindingFailure =
  | "SOURCE_NOT_FOUND"
  | "MULTIPLE_CANONICAL_CANDIDATES"
  | "ALIAS_ONLY"
  | "SHADOW_TARGET"
  | "STALE_VERSION"
  | "HASH_CHANGED_AFTER_BIND"
  | "AUTHORITY_CONFLICT"
  | "PROJECT_SCOPE_CONFLICT"
  | "UNRESOLVED_PROVENANCE";

export interface SourceBindingCandidate {
  object: SystemObjectRecord;
  aliasTargetObjectId?: string | null;
  provenanceStatus?: "RESOLVED" | "CONFLICT" | "UNKNOWN";
}

export interface SourceBindingRequest {
  projectId: string;
  requestedObject: string;
  requestedAction: SourceBindingAction;
  authorityOwner: string;
  requiredAuthorityClass?: SystemAuthorityClass;
  boundBy: string;
  boundAt?: string;
}

export interface SourceBindingProof {
  sourceBindingId: string;
  projectId: string;
  requestedObject: string;
  requestedAction: SourceBindingAction;
  resolvedCanonicalObject: string | null;
  sourceKind: string | null;
  authoritySource: string | null;
  authorityClass: SystemAuthorityClass | null;
  sourceVersion: string | null;
  resolutionProof: string[];
  aliasStatus: "NONE" | "RESOLVED_TO_CANONICAL" | "ALIAS_ONLY_CONFLICT";
  shadowStatus: "NONE" | "SHADOW_DETECTED" | "DUPLICATE_GENERATION" | "UNKNOWN";
  staleStatus: "CURRENT" | "STALE" | "PREDECESSOR" | "UNKNOWN";
  projectScopeStatus: "MATCH" | "CONFLICT" | "UNKNOWN";
  provenanceStatus: "RESOLVED" | "CONFLICT" | "UNKNOWN";
  mutationAllowed: boolean;
  boundAt: string;
  boundBy: string;
  failureReason: SourceBindingFailure | null;
}

export interface SourceBindingResolution {
  ok: boolean;
  proof: SourceBindingProof;
}
