import type { SourceBindingCandidate, SourceBindingProof, SourceBindingResolution } from "@/lib/source-binding/types";

export function verifySourceBinding(proof: SourceBindingProof, candidate: SourceBindingCandidate): SourceBindingResolution {
  const object = candidate.object;
  if (proof.projectId !== object.projectId || proof.projectId !== object.scope.projectId) {
    return { ok: false, proof: { ...proof, mutationAllowed: false, projectScopeStatus: "CONFLICT", failureReason: "PROJECT_SCOPE_CONFLICT" } };
  }
  if (proof.resolvedCanonicalObject !== object.objectId) {
    return { ok: false, proof: { ...proof, mutationAllowed: false, provenanceStatus: "CONFLICT", failureReason: "UNRESOLVED_PROVENANCE" } };
  }
  if (proof.sourceVersion !== object.contentHashOrVersion) {
    return { ok: false, proof: { ...proof, mutationAllowed: false, staleStatus: "STALE", failureReason: "HASH_CHANGED_AFTER_BIND" } };
  }
  if (proof.authoritySource !== object.authorityOwner || proof.authorityClass !== object.authorityClass) {
    return { ok: false, proof: { ...proof, mutationAllowed: false, provenanceStatus: "CONFLICT", failureReason: "AUTHORITY_CONFLICT" } };
  }
  return { ok: true, proof };
}
