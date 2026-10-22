import test from "node:test";
import assert from "node:assert/strict";
import type { SystemObjectRecord } from "../src/lib/system-register/types";
import { resolveSourceBinding } from "../src/lib/source-binding/resolver";
import { verifySourceBinding } from "../src/lib/source-binding/verify";

const current = (overrides: Partial<SystemObjectRecord> = {}): SystemObjectRecord => ({
  objectId: "mc-current-source", projectId: "mission-control", objectKind: "repository", semanticRole: "source",
  locator: "/workspace/projects/mission-control", scope: { projectId: "mission-control", boundary: "repository" },
  authorityOwner: "Dennis", authorityClass: "OPERATOR_ACCEPTED", currentness: "CURRENT",
  contentHashOrVersion: "git:286ba38e", evidenceState: "PROVEN", evidenceRefs: ["git:HEAD"],
  lineageFrom: [], derivedFrom: [], duplicateOf: null, observedAt: "2026-09-26T02:00:00.000Z",
  reverifyCondition: "HEAD or authority changes", ...overrides,
});
const request = (requestedObject = "mc-current-source") => ({
  projectId: "mission-control", requestedObject, requestedAction: "WRITE" as const,
  authorityOwner: "Dennis", requiredAuthorityClass: "OPERATOR_ACCEPTED" as const,
  boundBy: "MC-D7.I2-test", boundAt: "2026-09-26T02:01:00.000Z",
});

test("valid canonical source binding returns provenance proof", () => {
  const result = resolveSourceBinding(request(), [{ object: current(), provenanceStatus: "RESOLVED" }]);
  assert.equal(result.ok, true); assert.equal(result.proof.mutationAllowed, true);
  assert.equal(result.proof.sourceVersion, "git:286ba38e"); assert.deepEqual(result.proof.resolutionProof, ["git:HEAD"]);
});

test("missing source fails closed", () => {
  assert.equal(resolveSourceBinding(request(), []).proof.failureReason, "SOURCE_NOT_FOUND");
});

test("ambiguous canonical candidates fail closed", () => {
  const a=current({objectId:"a",locator:"logical:mc"}); const b=current({objectId:"b",locator:"logical:mc"});
  assert.equal(resolveSourceBinding(request("logical:mc"), [{object:a},{object:b}]).proof.failureReason, "MULTIPLE_CANONICAL_CANDIDATES");
});

test("stale predecessor and shadow duplicate are rejected", () => {
  assert.equal(resolveSourceBinding(request(), [{object:current({currentness:"PREDECESSOR"})}]).proof.failureReason, "STALE_VERSION");
  assert.equal(resolveSourceBinding(request(), [{object:current({currentness:"DUPLICATE",duplicateOf:"mc-current"})}]).proof.failureReason, "SHADOW_TARGET");
});

test("authority mismatch fails closed", () => {
  assert.equal(resolveSourceBinding(request(), [{object:current({authorityOwner:"Other"})}]).proof.failureReason, "AUTHORITY_CONFLICT");
});

test("unresolved provenance fails closed", () => {
  assert.equal(resolveSourceBinding(request(), [{object:current({evidenceState:"PARTIAL"}),provenanceStatus:"UNKNOWN"}]).proof.failureReason, "UNRESOLVED_PROVENANCE");
});

test("cross-project candidate is rejected", () => {
  const foreign=current({projectId:"other",scope:{projectId:"other",boundary:"repository"}});
  assert.equal(resolveSourceBinding(request(), [{object:foreign}]).proof.failureReason, "PROJECT_SCOPE_CONFLICT");
});

test("alias without proven canonical target is rejected", () => {
  assert.equal(resolveSourceBinding(request(), [{object:current(),aliasTargetObjectId:"missing-target"}]).proof.failureReason, "ALIAS_ONLY");
});

test("hash change after bind invalidates proof", () => {
  const candidate={object:current(),provenanceStatus:"RESOLVED" as const}; const bound=resolveSourceBinding(request(),[candidate]);
  assert.equal(bound.ok,true); const changed={...candidate,object:current({contentHashOrVersion:"git:changed"})};
  assert.equal(verifySourceBinding(bound.proof,changed).proof.failureReason,"HASH_CHANGED_AFTER_BIND");
});

test("derived read projection may bind for read but never authorizes mutation", () => {
  const projection=current({objectKind:"projection",semanticRole:"projection",currentness:"DERIVED",derivedFrom:["mc-current-source"],contentHashOrVersion:"sha256:projection"});
  const readReq={...request(),requestedAction:"READ" as const}; assert.equal(resolveSourceBinding(readReq,[{object:projection}]).ok,true);
  assert.equal(resolveSourceBinding(request(),[{object:projection}]).proof.failureReason,"STALE_VERSION");
});
