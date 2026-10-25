import assert from "node:assert/strict";
import {assessStageNativeTransport,type StageTransportEvidence} from "../src/lib/cli-agents/stage-native-transport-gate";

const valid:StageTransportEvidence={
  stage:true,stageSession:true,profileIsolated:true,stageCredential:true,transportIsolated:true,
};
assert.deepEqual(assessStageNativeTransport(valid),{canSend:true,code:"READY_FOR_DENNNIS_FIRST_TURN"});
assert.equal(assessStageNativeTransport({...valid,stage:false}).code,"NOT_ISOLATED_STAGE");
assert.equal(assessStageNativeTransport({...valid,stageSession:false}).code,"STAGE_SESSION_ID_INVALID");
assert.equal(assessStageNativeTransport({...valid,profileIsolated:false}).code,"NATIVE_PROFILE_UNVERIFIED");
assert.equal(assessStageNativeTransport({...valid,stageCredential:false}).code,"STAGE_NATIVE_KEY_MISSING");
assert.equal(assessStageNativeTransport({...valid,transportIsolated:false}).code,"STAGE_NATIVE_TRANSPORT_UNAVAILABLE");
console.log("stage native transport isolation tests: PASS");
