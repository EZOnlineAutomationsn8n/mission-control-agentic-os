import type {
  SystemAuthorityClass,
  SystemCurrentness,
  SystemEvidenceState,
  SystemObjectKind,
  SystemObjectRecord,
  SystemObjectValidationResult,
  SystemSemanticRole,
} from "@/lib/system-register/types";

const OBJECT_KINDS = new Set<SystemObjectKind>([
  "repository", "runtime", "service", "source", "projection",
  "database", "document", "session", "archive", "other",
]);
const SEMANTIC_ROLES = new Set<SystemSemanticRole>([
  "plan", "current_state", "active_work", "evidence", "decision", "handoff",
  "register", "runtime", "source", "projection", "archive", "incident", "other",
]);
const AUTHORITY_CLASSES = new Set<SystemAuthorityClass>([
  "OPERATOR_ACCEPTED", "TECHNICAL_RUNTIME", "DECLARED_CANDIDATE", "NONE",
]);
const CURRENTNESS = new Set<SystemCurrentness>([
  "CURRENT", "ACTIVE_SUPPORTING", "PREDECESSOR", "DERIVED",
  "ARCHIVE", "DUPLICATE", "CANDIDATE", "UNKNOWN",
]);
const EVIDENCE_STATES = new Set<SystemEvidenceState>([
  "PROVEN", "PARTIAL", "CLAIMED", "UNKNOWN",
]);

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonEmpty);
function validIso(value: unknown): boolean {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

export function validateSystemObject(input: unknown): SystemObjectValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { valid: false, errors: ["OBJECT_REQUIRED"] };
  const record = input as Partial<SystemObjectRecord>;

  if (!nonEmpty(record.objectId)) errors.push("OBJECT_ID_REQUIRED");
  if (!nonEmpty(record.projectId)) errors.push("PROJECT_ID_REQUIRED");
  if (!OBJECT_KINDS.has(record.objectKind as SystemObjectKind)) errors.push("OBJECT_KIND_INVALID");
  if (!SEMANTIC_ROLES.has(record.semanticRole as SystemSemanticRole)) errors.push("SEMANTIC_ROLE_INVALID");
  if (!nonEmpty(record.locator)) errors.push("LOCATOR_REQUIRED");
  if (!record.scope || typeof record.scope !== "object") errors.push("SCOPE_REQUIRED");
  if (record.scope && record.scope.projectId !== record.projectId) errors.push("PROJECT_SCOPE_CONFLICT");
  if (record.scope && !nonEmpty(record.scope.boundary)) errors.push("SCOPE_BOUNDARY_REQUIRED");
  if (!nonEmpty(record.authorityOwner)) errors.push("AUTHORITY_OWNER_REQUIRED");
  if (!AUTHORITY_CLASSES.has(record.authorityClass as SystemAuthorityClass)) errors.push("AUTHORITY_CLASS_INVALID");
  if (!CURRENTNESS.has(record.currentness as SystemCurrentness)) errors.push("CURRENTNESS_INVALID");
  if (!EVIDENCE_STATES.has(record.evidenceState as SystemEvidenceState)) errors.push("EVIDENCE_STATE_INVALID");
  if (!stringArray(record.evidenceRefs)) errors.push("EVIDENCE_REFS_INVALID");
  if (!stringArray(record.lineageFrom)) errors.push("LINEAGE_FROM_INVALID");
  if (!stringArray(record.derivedFrom)) errors.push("DERIVED_FROM_INVALID");
  if (!validIso(record.observedAt)) errors.push("OBSERVED_AT_INVALID");
  if (!nonEmpty(record.reverifyCondition)) errors.push("REVERIFY_CONDITION_REQUIRED");
  if (record.evidenceState === "PROVEN" && (!record.evidenceRefs || record.evidenceRefs.length === 0)) {
    errors.push("PROVEN_EVIDENCE_REQUIRES_REFERENCE");
  }
  if (record.currentness === "DERIVED") {
    if (!record.derivedFrom || record.derivedFrom.length === 0) errors.push("DERIVED_REQUIRES_SOURCE");
    if (!nonEmpty(record.contentHashOrVersion)) errors.push("DERIVED_REQUIRES_VERSION");
  }
  if (record.currentness === "DUPLICATE" && !nonEmpty(record.duplicateOf)) {
    errors.push("DUPLICATE_REQUIRES_DUPLICATE_OF");
  }

  if (record.semanticRole === "handoff") {
    const handoff = record.handoff;
    if (!handoff) {
      errors.push("HANDOFF_METADATA_REQUIRED");
    } else {
      if (handoff.handoffStatus !== "DERIVED_TRANSFER_ARTIFACT") errors.push("HANDOFF_STATUS_INVALID");
      if (handoff.canonicalStateSource !== false) errors.push("HANDOFF_CANNOT_BE_CANONICAL_STATE_SOURCE");
      if (!nonEmpty(handoff.generatedFromVersion)) errors.push("HANDOFF_SOURCE_VERSION_REQUIRED");
      if (!validIso(handoff.generatedAt)) errors.push("HANDOFF_GENERATED_AT_INVALID");
      if (!nonEmpty(handoff.expiresAt) && !nonEmpty(handoff.expiresWhen)) errors.push("HANDOFF_EXPIRY_REQUIRED");
      if (handoff.expiresAt && !validIso(handoff.expiresAt)) errors.push("HANDOFF_EXPIRES_AT_INVALID");
    }
    if (!record.derivedFrom || record.derivedFrom.length === 0) errors.push("HANDOFF_REQUIRES_DERIVED_FROM");
  }

  return { valid: errors.length === 0, errors };
}