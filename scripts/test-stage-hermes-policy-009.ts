import {test} from "node:test";
import assert from "node:assert/strict";
import {hermesStagePinnedArgs} from "../src/lib/cli-agents/hermes-runner";
import {assessStageNativeFree, type StageFreeEvidence} from "../src/lib/cli-agents/stage-native-free-gate";
const positive:StageFreeEvidence={
 stage:true,stageSession:true,profileIsolated:true,nativeModelExact:true,
 providerExact:true,fallbackEmpty:true,nativeToolsDisabled:true,
 stageCredential:true,transportIsolated:true,catalogTextFree:true,
 extraToolFeesDisabled:true
};
test("Hermes stage CLI always pins original free provider/model and restricts turn count",()=>{
 const args=hermesStagePinnedArgs();
 assert.deepEqual(args,["--provider","openrouter","--model","nvidia/nemotron-3-ultra-550b-a55b:free",
 "--max-turns","1"]);
 assert.equal(args.includes("--yolo"),false);
 assert.equal(args.includes("--toolsets"),false,"toolsets MUST NOT be represented as verified");
});
test("Hermes native unsupported fallback stays denied without pretending it is nonempty",()=>{
 assert.equal(assessStageNativeFree({...positive,fallbackEmpty:false}).canSend,false);
 assert.equal(assessStageNativeFree({...positive,nativeToolsDisabled:false}).canSend,false);
 assert.equal(assessStageNativeFree({...positive,extraToolFeesDisabled:false}).canSend,false);
});
test("Fail closed for stage secret, all native cost evidence, model and provider identity",()=>{
 for(const key of ["stageCredential","catalogTextFree","transportIsolated","providerExact","nativeModelExact"] as const){
  assert.equal(assessStageNativeFree({...positive,[key]:false}).canSend,false,key);
 }
});
