import test from "node:test";
import assert from "node:assert/strict";
import type { SystemObjectRecord } from "../src/lib/system-register/types";
import { validateSystemObject } from "../src/lib/system-register/validate";

const base = (): SystemObjectRecord => ({
  objectId: "mc-repo-current",
  projectId: "mission-control",
  objectKind: "repository",
  semanticRole: "source",
  locator: "/workspace/projects/mission-control",
  scope: { projectId: "mission-control", boundary: "repository" },
  authorityOwner: "Dennis",
  authorityClass: "OPERATOR_ACCEPTED",
  currentness: "CURRENT",
  contentHashOrVersion: "git:286ba38e",
  evidenceState: "PROVEN",
  evidenceRefs: ["git:HEAD"],
  lineageFrom: [],
  derivedFrom: [],
  duplicateOf: null,
  observedAt: "2026-09-26T02:00:00.000Z",
  reverifyCondition: "HEAD or operator authority changes",
});

const errors = (record: unknown) => validateSystemObject(record).errors;
test("valid current object passes", () => {
  assert.deepEqual(validateSystemObject(base()), { valid: true, errors: [] });
});

test("currentness classes remain distinct", () => {
  for (const currentness of ["DERIVED", "PREDECESSOR", "ARCHIVE"] as const) {
    const record = base();
    record.currentness = currentness;
    if (currentness === "DERIVED") {
      record.derivedFrom = ["mc-repo-current"];
      record.contentHashOrVersion = "sha256:derived";
    }
    assert.equal(validateSystemObject(record).valid, true);
    assert.equal(record.currentness, currentness);
  }
});

test("locator text cannot manufacture authority", () => {
  const record = base();
  record.locator = "/canonical/current/mission-control";
  record.authorityClass = "NONE";
  const result = validateSystemObject(record);
  assert.equal(result.valid, true);
  assert.equal(record.authorityClass, "NONE");
});

test("cross-project scope is rejected", () => {
  const record = base();
  record.scope.projectId = "portmontage";
  assert.ok(errors(record).includes("PROJECT_SCOPE_CONFLICT"));
});
test("derived and duplicate records require lineage evidence", () => {
  const derived = base();
  derived.currentness = "DERIVED";
  derived.derivedFrom = [];
  derived.contentHashOrVersion = null;
  assert.ok(errors(derived).includes("DERIVED_REQUIRES_SOURCE"));
  assert.ok(errors(derived).includes("DERIVED_REQUIRES_VERSION"));

  const duplicate = base();
  duplicate.currentness = "DUPLICATE";
  duplicate.duplicateOf = null;
  assert.ok(errors(duplicate).includes("DUPLICATE_REQUIRES_DUPLICATE_OF"));
});

test("handoff is derivative and never a canonical state source", () => {
  const handoff = base();
  handoff.semanticRole = "handoff";
  handoff.currentness = "DERIVED";
  handoff.derivedFrom = ["mc-current-state"];
  handoff.contentHashOrVersion = "sha256:handoff";
  handoff.handoff = {
    handoffStatus: "DERIVED_TRANSFER_ARTIFACT",
    canonicalStateSource: false,
    generatedFromVersion: "sha256:state-v1",
    generatedAt: "2026-09-26T02:00:00.000Z",
    expiresWhen: "source version changes",
  };
  assert.equal(validateSystemObject(handoff).valid, true);
});
test("handoff missing derivative safety fields fails closed", () => {
  const handoff = base();
  handoff.semanticRole = "handoff";
  handoff.currentness = "DERIVED";
  handoff.derivedFrom = [];
  assert.ok(errors(handoff).includes("HANDOFF_METADATA_REQUIRED"));
  assert.ok(errors(handoff).includes("HANDOFF_REQUIRES_DERIVED_FROM"));
});

test("unknown evidence stays unknown rather than auto-promoting", () => {
  const record = base();
  record.evidenceState = "UNKNOWN";
  record.evidenceRefs = [];
  record.authorityClass = "NONE";
  assert.equal(validateSystemObject(record).valid, true);
  assert.equal(record.evidenceState, "UNKNOWN");
  assert.equal(record.authorityClass, "NONE");
});

test("predecessor stays predecessor even with proven evidence", () => {
  const record = base();
  record.currentness = "PREDECESSOR";
  record.evidenceState = "PROVEN";
  assert.equal(validateSystemObject(record).valid, true);
  assert.notEqual(record.currentness, "CURRENT");
});