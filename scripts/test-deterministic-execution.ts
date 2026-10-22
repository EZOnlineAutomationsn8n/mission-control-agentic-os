import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSha256 } from "../src/lib/determinism/canonicalize";
import { buildExecutionEnvelope, compareReplay } from "../src/lib/determinism/execution-envelope";
import { createExecutionReceipt, detectDuplicateEffect, verifyReceiptChain } from "../src/lib/determinism/trace-receipt";
import { resolveSourceBinding } from "../src/lib/source-binding/resolver";
import type { SystemObjectRecord } from "../src/lib/system-register/types";

const source = (version = "git:286ba38e"): SystemObjectRecord => ({
  objectId:"mc-current-source",projectId:"mission-control",objectKind:"repository",semanticRole:"source",
  locator:"/workspace/projects/mission-control",scope:{projectId:"mission-control",boundary:"repository"},
  authorityOwner:"Dennis",authorityClass:"OPERATOR_ACCEPTED",currentness:"CURRENT",contentHashOrVersion:version,
  evidenceState:"PROVEN",evidenceRefs:["git:HEAD"],lineageFrom:[],derivedFrom:[],duplicateOf:null,
  observedAt:"2026-09-26T02:00:00.000Z",reverifyCondition:"HEAD changes",
});
const binding = (version = "git:286ba38e") => {
  const result=resolveSourceBinding({projectId:"mission-control",requestedObject:"mc-current-source",requestedAction:"WRITE",authorityOwner:"Dennis",requiredAuthorityClass:"OPERATOR_ACCEPTED",boundBy:"I3-test",boundAt:"2026-09-26T02:01:00.000Z"},[{object:source(version),provenanceStatus:"RESOLVED"}]);
  assert.equal(result.ok,true); return result.proof;
};
const envelope = (overrides: Record<string, unknown> = {}) => buildExecutionEnvelope({
  semanticRequest:{target:"mc-current-source",change:{enabled:true,count:2}},projectId:"mission-control",actionKind:"WRITE_SOURCE",
  sourceBinding:binding(),idempotencyKey:"idem-1",baseStateVersion:"git:286ba38e",executionContractVersion:"mc-exec-v1",
  governedVersions:{policy:"p1",schema:"s1"},effectClass:"REVERSIBLE_WRITE",correlationId:"corr-a",recordedAt:"2026-09-26T02:02:00.000Z",
  ...overrides,
});

test("canonical object key order does not change fingerprint",()=>{
  assert.equal(canonicalSha256({b:2,a:1}),canonicalSha256({a:1,b:2}));
});
test("runtime envelope noise does not change semantic request identity",()=>{
  const a=envelope(); const b=envelope({correlationId:"corr-b",recordedAt:"2026-09-26T03:00:00.000Z"});
  assert.equal(a.requestFingerprint,b.requestFingerprint); assert.equal(a.replayIdentity,b.replayIdentity);
});
test("semantic payload change changes fingerprint",()=>{
  assert.notEqual(envelope().requestFingerprint,envelope({semanticRequest:{target:"mc-current-source",change:{enabled:false,count:2}}}).requestFingerprint);
});
test("unsupported normalization version fails closed",()=>{
  assert.throws(()=>envelope({normalizationVersion:"future-v2"}),/NORMALIZATION_UNAVAILABLE/);
});
test("base-state and source-binding drift break replay equivalence",()=>{
  const original=envelope(); const baseChanged=envelope({baseStateVersion:"git:changed"});
  assert.equal(compareReplay(original,baseChanged),"BASE_STATE_CHANGED");
  const bindingChanged=envelope({sourceBinding:binding("git:changed")});
  assert.equal(compareReplay(original,bindingChanged),"SOURCE_BINDING_CHANGED");
});
test("execution contract and governed world drift are detected",()=>{
  const original=envelope(); assert.equal(compareReplay(original,envelope({executionContractVersion:"mc-exec-v2"})),"EXECUTION_CONTRACT_CHANGED");
  assert.equal(compareReplay(original,envelope({governedVersions:{policy:"p2",schema:"s1"}})),"REPLAY_WORLD_DRIFT");
});
test("accepted effect identity blocks duplicate effect",()=>{
  const first=envelope(); const receipt=createExecutionReceipt({envelope:first,result:"ACCEPTED"});
  assert.equal(detectDuplicateEffect(envelope(),[receipt]),"DUPLICATE_EFFECT_ATTEMPT");
  assert.equal(detectDuplicateEffect(envelope({idempotencyKey:"idem-2"}),[receipt]),null);
});
test("trace receipt chain validates and tampering fails",()=>{
  const first=createExecutionReceipt({envelope:envelope({idempotencyKey:"idem-a"}),result:"ACCEPTED"});
  const second=createExecutionReceipt({envelope:envelope({idempotencyKey:"idem-b"}),result:"BLOCKED",failureReason:"CONTROLLED_TEST",previousReceipt:first});
  assert.deepEqual(verifyReceiptChain([first,second]),{valid:true,failureReason:null,index:null});
  assert.deepEqual(verifyReceiptChain([first,{...second,tracePrevHash:"bad"}]),{valid:false,failureReason:"TRACE_CHAIN_MISMATCH",index:1});
});
test("correlation identity remains operational, not semantic",()=>{
  const a=envelope({correlationId:"random-1"}); const b=envelope({correlationId:"random-2"});
  assert.notEqual(a.correlationId,b.correlationId); assert.equal(a.requestFingerprint,b.requestFingerprint); assert.equal(a.versionStateFingerprint,b.versionStateFingerprint);
});
