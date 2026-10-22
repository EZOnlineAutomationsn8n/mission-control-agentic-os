export type SystemObjectKind =
  | "repository"
  | "runtime"
  | "service"
  | "source"
  | "projection"
  | "database"
  | "document"
  | "session"
  | "archive"
  | "other";

export type SystemSemanticRole =
  | "plan"
  | "current_state"
  | "active_work"
  | "evidence"
  | "decision"
  | "handoff"
  | "register"
  | "runtime"
  | "source"
  | "projection"
  | "archive"
  | "incident"
  | "other";

export type SystemAuthorityClass =
  | "OPERATOR_ACCEPTED"
  | "TECHNICAL_RUNTIME"
  | "DECLARED_CANDIDATE"
  | "NONE";
export type SystemCurrentness =
  | "CURRENT"
  | "ACTIVE_SUPPORTING"
  | "PREDECESSOR"
  | "DERIVED"
  | "ARCHIVE"
  | "DUPLICATE"
  | "CANDIDATE"
  | "UNKNOWN";

export type SystemEvidenceState = "PROVEN" | "PARTIAL" | "CLAIMED" | "UNKNOWN";

export interface SystemObjectScope {
  projectId: string;
  boundary: string;
}

export interface HandoffSafetyMetadata {
  handoffStatus: "DERIVED_TRANSFER_ARTIFACT";
  canonicalStateSource: false;
  generatedFromVersion: string;
  generatedAt: string;
  expiresAt?: string;
  expiresWhen?: string;
}

export interface SystemObjectRecord {
  objectId: string;
  projectId: string;
  objectKind: SystemObjectKind;
  semanticRole: SystemSemanticRole;
  locator: string;
  scope: SystemObjectScope;
  authorityOwner: string;
  authorityClass: SystemAuthorityClass;
  currentness: SystemCurrentness;
  contentHashOrVersion: string | null;
  evidenceState: SystemEvidenceState;
  evidenceRefs: string[];
  lineageFrom: string[];
  derivedFrom: string[];
  duplicateOf: string | null;
  observedAt: string;
  reverifyCondition: string;
  notes?: string;
  handoff?: HandoffSafetyMetadata;
}

export interface SystemObjectValidationResult {
  valid: boolean;
  errors: string[];
}

export interface SystemObjectAuthorityAssessment {
  mutationAuthoritative: boolean;
  reasons: string[];
}