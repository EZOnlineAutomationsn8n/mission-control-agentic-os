import {test} from "node:test";
import assert from "node:assert/strict";
import {hermesStagePinnedArgs} from "../src/lib/cli-agents/hermes-runner";
import {assessStageNativeFree,hermesExplicitNoFallbackNoToolsConfig,stageNativeExecWorkspace,
 type StageFreeEvidence} from "../src/lib/cli-agents/stage-native-free-gate";
import {mkdtemp,mkdir,chmod,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
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

test("Hermes native source-pinned stage policy rejects fallback, tool and fee deviations",()=>{
 const good=[
  "model:",
  "  provider: openrouter",
  "  default: nvidia/nemotron-3-ultra-550b-a55b:free",
  "fallback_providers: []",
  "fallback_model: []",
  "platform_toolsets:",
  "  cli: []",
  "agent:",
  "  disabled_toolsets:",
  "    - all",
  "  max_turns: 1",
  "mcp_servers: {}",
 ].join("\n");
 assert.equal(hermesExplicitNoFallbackNoToolsConfig(good),true);
 assert.equal(hermesExplicitNoFallbackNoToolsConfig(good.replace("fallback_model: []","fallback_model: bad")),false);
 assert.equal(hermesExplicitNoFallbackNoToolsConfig(good.replace("  cli: []","  cli: [web]")),false);
 assert.equal(hermesExplicitNoFallbackNoToolsConfig(good.replace("    - all","    - web")),false);
 assert.equal(hermesExplicitNoFallbackNoToolsConfig(good+"\nproviders: {}"),false);
});
test("Native stage execution never follows legacy project-root cwd",async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),"gaos-native-cwd-"));
 const root=path.join(folder,".stage-achtergrond",".preview-native-home");
 const old={preview:process.env.MC_PREVIEW,isolated:process.env.GAOS_STAGE_NATIVE_ISOLATED,
   root:process.env.GAOS_STAGE_NATIVE_ROOT};
 try{
  await mkdir(path.join(root,"hermes","workspace-mission-control"),{recursive:true,mode:0o700});
  await chmod(root,0o700);await chmod(path.join(root,"hermes"),0o700);
  const cwd=path.join(root,"hermes","workspace-mission-control");
  await chmod(cwd,0o700);
  process.env.MC_PREVIEW="1";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
  process.env.GAOS_STAGE_NATIVE_ROOT=root;
  assert.equal(await stageNativeExecWorkspace("hermes"),cwd);
  assert.notEqual(cwd,"/workspace/projects/mission-control");
  await rm(cwd,{recursive:true});
  await symlink("/workspace/projects/mission-control",cwd);
  await assert.rejects(stageNativeExecWorkspace("hermes"),/NATIVE_STAGE_WORKSPACE_ISOLATION_UNVERIFIED/);
  process.env.MC_PREVIEW="0";
  await assert.rejects(stageNativeExecWorkspace("hermes"),/NATIVE_STAGE_WORKSPACE_MODE_UNVERIFIED/);
 }finally{
  if(old.preview===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=old.preview;
  if(old.isolated===undefined)delete process.env.GAOS_STAGE_NATIVE_ISOLATED;else process.env.GAOS_STAGE_NATIVE_ISOLATED=old.isolated;
  if(old.root===undefined)delete process.env.GAOS_STAGE_NATIVE_ROOT;else process.env.GAOS_STAGE_NATIVE_ROOT=old.root;
  await rm(folder,{recursive:true,force:true});
 }
});
