import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm,readFile} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {inspectNativeStageTransport,assessStageNativeTransport} from "../src/lib/cli-agents/stage-native-transport-gate";
import {hermesStagePinnedArgs} from "../src/lib/cli-agents/hermes-runner";

test("Operator-configured primary/fallbacks remain native configuration",async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),"gaos010-pass5-"));
 const root=path.join(temp,".stage-achtergrond",".preview-native-home");
 const hp=path.join(root,"hermes");
 const op=path.join(root,"openclaw");
 const old={preview:process.env.MC_PREVIEW,iso:process.env.GAOS_STAGE_NATIVE_ISOLATED,
  native:process.env.GAOS_STAGE_NATIVE_ROOT,hermes:process.env.HERMES_HOME,
  openclaw:process.env.OPENCLAW_STATE_DIR};
 let fetchCount=0;
 const fetchBefore=globalThis.fetch;
 try{
  for(const folder of [root,hp,op,path.join(hp,"workspace-mission-control"),
     path.join(op,"workspace-mission-control")])await mkdir(folder,{recursive:true,mode:0o700});
  await writeFile(path.join(hp,"config.yaml"),[
   "model:","  provider: openrouter","  default: someone/operator-choice",
   "fallback_providers: [openrouter]","fallback_model: [someone/second-choice]",
   "agent:","  max_turns: 1"].join("\n")+"\n");
  await writeFile(path.join(op,"openclaw.json"),JSON.stringify({
   agents:{defaults:{model:{primary:"openrouter/operator-selected-primary",
     fallbacks:["openrouter/operator-selected-fallback"]}},
    list:[{id:"mission-control",model:"openrouter/operator-selected-primary",
      agentDir:path.join(op,"agents","mission-control"),workspace:path.join(op,"workspace-mission-control")}]},
   tools:{deny:["*"]}}));
  process.env.MC_PREVIEW="1";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
  process.env.GAOS_STAGE_NATIVE_ROOT=root;process.env.HERMES_HOME=hp;process.env.OPENCLAW_STATE_DIR=op;
  globalThis.fetch=(async()=>{fetchCount++;throw Error("NETWORK_NOT_ALLOWED")}) as typeof fetch;
  for(const [agent,selected] of [
   ["hermes","someone/operator-choice"],
   ["openclaw","openrouter/operator-selected-primary"]
  ] as const){
   const status=await inspectNativeStageTransport(agent,"acf-werkplaats-"+agent);
   assert.equal(status.configuredModel,selected);
   assert.equal(status.profileReadable,true);
   assert.equal(status.canSend,false);
   assert.equal(status.code,"STAGE_NATIVE_KEY_MISSING");
  }
  assert.equal(fetchCount,0,"no external network request at inspect");
 }finally{
  globalThis.fetch=fetchBefore;
  for(const [key,value] of Object.entries({
    MC_PREVIEW:old.preview,GAOS_STAGE_NATIVE_ISOLATED:old.iso,GAOS_STAGE_NATIVE_ROOT:old.native,
    HERMES_HOME:old.hermes,OPENCLAW_STATE_DIR:old.openclaw
  })) if(value===undefined)delete process.env[key];else process.env[key]=value;
  await rm(temp,{recursive:true,force:true});
 }
});

test("Current genuine stage profiles preserve their original primary and fallback arrays",async()=>{
 const dir=path.join(process.cwd(),".preview-native-home");
 const hermes=await readFile(path.join(dir,"hermes","config.yaml"),"utf8");
 const openclaw=JSON.parse(await readFile(path.join(dir,"openclaw","openclaw.json"),"utf8")) as {
  agents:{defaults:{model:{primary:string;fallbacks:string[]}}}
 };
 assert.match(hermes,/default: nvidia\/nemotron-3-ultra-550b-a55b:free/);
 assert.match(hermes,/fallback_model: \[\]/);
 assert.equal(openclaw.agents.defaults.model.primary,
   "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free");
 assert.deepEqual(openclaw.agents.defaults.model.fallbacks,["openrouter/nvidia/nemotron-3-super-120b-a12b:free"]);
});

test("Native runners do not inject model override; OpenClaw still --local",()=>{
 assert.deepEqual(hermesStagePinnedArgs(),["--max-turns","1"]);
 const openclaw=readFileSync(path.join(process.cwd(),"src/lib/cli-agents/openclaw-runner.ts"),"utf8");
 assert.match(openclaw,/\.\.\.\(preview\?\["--local"\]:\[\]\)/);
 assert.doesNotMatch(openclaw,/\["--local","--model"/);
});

test("Native send gate admits operator model selection but still enforces actual stage security",()=>{
 const safe={stage:true,stageSession:true,profileIsolated:true,stageCredential:true,transportIsolated:true};
 assert.equal(assessStageNativeTransport(safe).canSend,true);
 assert.equal(assessStageNativeTransport({...safe,stageCredential:false}).code,"STAGE_NATIVE_KEY_MISSING");
 assert.equal(assessStageNativeTransport({...safe,transportIsolated:false}).code,"STAGE_NATIVE_TRANSPORT_UNAVAILABLE");
});
test("ACF prepare is stage-local only and has no live source dependency",()=>{
 const route=readFileSync(path.join(process.cwd(),"src/app/api/acf/team-room/prepare/route.ts"),"utf8");
 assert.doesNotMatch(route,/3330/);
 assert.match(route,/prepareClaudeAfcStageSession/);
 assert.match(route,/validateWerkplaatsOperator/);
 assert.match(route,/readyForDennisUat:false/);
});
test("Gemini stage admission reports only native authentication state",()=>{
 const route=readFileSync(path.join(process.cwd(),"src/lib/cli-agents/api.ts"),"utf8");
 assert.match(route,/GEMINI_STAGE_NATIVE_AUTH_NOT_CONFIGURED/);
 assert.match(route,/agentId === "hermes" \|\| \(agentId === "codex"/);
});
