/** Stage-only native transport pre-dispatch barrier.
 * Reuses the certified public OpenRouter price-check; not a second router.
 * Does not mark a session ELIGIBLE (ACF owns that verdict after a native turn).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { readOfficialUatCatalog, type CatalogReadiness } from "@/lib/acf/official-openrouter-pricing";
import { stageNativeKeyPresent, readStageNativeKey } from "./stage-native-secret";

export type StageNativeAgent="hermes"|"openclaw";
export const STAGE_NATIVE_MODEL="openrouter/nvidia/nemotron-3-ultra-550b-a55b:free";
export type StageFreeEvidence={
  stage:boolean;stageSession:boolean;profileIsolated:boolean;
  nativeModelExact:boolean;providerExact:boolean;fallbackEmpty:boolean;nativeToolsDisabled:boolean;
  stageCredential:boolean;transportIsolated:boolean;catalogTextFree:boolean;
  extraToolFeesDisabled:boolean;
};
export type StageTransportCode=
  "READY_FOR_DENNNIS_FIRST_TURN"|"NOT_ISOLATED_STAGE"|"STAGE_SESSION_ID_INVALID"|
  "NATIVE_PROFILE_UNVERIFIED"|"STAGE_PROVIDER_MODEL_MISMATCH"|
  "STAGE_FALLBACK_NOT_EMPTY"|"NATIVE_TOOLS_OR_FEES_UNVERIFIED"|
  "STAGE_NATIVE_KEY_MISSING"|"STAGE_NATIVE_TRANSPORT_UNAVAILABLE"|
  "OPENROUTER_ENDPOINT_PRICE_NOT_VERIFIED"|"HERMES_NATIVE_POLICY_UNVERIFIED";
export function assessStageNativeFree(e:StageFreeEvidence):{canSend:boolean;code:StageTransportCode}{
 const blocked=(code:StageTransportCode)=>({canSend:false,code});
 if(!e.stage)return blocked("NOT_ISOLATED_STAGE");
 if(!e.stageSession)return blocked("STAGE_SESSION_ID_INVALID");
 if(!e.profileIsolated)return blocked("NATIVE_PROFILE_UNVERIFIED");
 if(!e.nativeModelExact||!e.providerExact)return blocked("STAGE_PROVIDER_MODEL_MISMATCH");
 if(!e.fallbackEmpty)return blocked("STAGE_FALLBACK_NOT_EMPTY");
 if(!e.nativeToolsDisabled||!e.extraToolFeesDisabled)return blocked("NATIVE_TOOLS_OR_FEES_UNVERIFIED");
 if(!e.stageCredential)return blocked("STAGE_NATIVE_KEY_MISSING");
 if(!e.transportIsolated)return blocked("STAGE_NATIVE_TRANSPORT_UNAVAILABLE");
 if(!e.catalogTextFree)return blocked("OPENROUTER_ENDPOINT_PRICE_NOT_VERIFIED");
 return {canSend:true,code:"READY_FOR_DENNNIS_FIRST_TURN"};
}
export type StageTransportStatus={
 agentId:StageNativeAgent;stageSource:"STAGE_NATIVE_PROFILE_AND_OFFICIAL_CATALOG";
 costMode:"FREE_ONLY";configuredModel:string|null;
 stageCredentialConfigured:boolean;configVerified:boolean;
 effectiveFallbacks:"NONE"|"UNKNOWN_OR_NONEMPTY";
 toolsVerifiedDisabled:boolean;
 gateway:"EMBEDDED_STAGE"|"UNVERIFIED";
 catalogStatus:string;catalogCode:string;checkedAt:string|null;
 canSend:boolean;code:StageTransportCode;
 providerCalls:0;
};
let cached:{time:number;value:CatalogReadiness}|null=null;
async function catalog():Promise<CatalogReadiness>{
 if(cached&&Date.now()-cached.time<25000)return cached.value;
 const value=await readOfficialUatCatalog();
 cached={time:Date.now(),value};return value;
}
async function regularPrivateDir(p:string):Promise<boolean>{
 try{const s=await fs.lstat(p);return s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0;}
 catch{return false;}
}
async function readBoundedStageFile(p:string,max=16384):Promise<string|null>{
 try{const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>max)return null;return await fs.readFile(p,"utf8");}
 catch{return null;}
}
export async function inspectNativeStageTransport(agentId:StageNativeAgent,sessionKey:string):Promise<StageTransportStatus>{
 const root=process.env.GAOS_STAGE_NATIVE_ROOT||"";
 const stage=process.env.MC_PREVIEW==="1"&&process.env.GAOS_STAGE_NATIVE_ISOLATED==="1"&&
   path.isAbsolute(root)&&path.resolve(root).endsWith("/.stage-achtergrond/.preview-native-home");
 const ownHome=path.join(root||"/nonexistent",agentId);
 const dirs=stage&&(await regularPrivateDir(root))&&(await regularPrivateDir(ownHome));
 const credential=await stageNativeKeyPresent();
 let exact=false,provider=false,fall=false,tools=false,isolated=false;
 let model:string|null=null;
 if(dirs&&agentId==="hermes"){
   const text=await readBoundedStageFile(path.join(ownHome,"config.yaml"));
   // Strict stage-only known keys. Extra provider/tool/fallback config cannot
   // accidentally be classified as free without a native CLI certification.
   const m=text?.match(/^\s*default:\s*(nvidia\/[a-z0-9-]+:free)\s*$/m);
   const p=text?.match(/^\s*provider:\s*([a-z0-9_-]+)\s*$/m);
   model=m?.[1]??null;
   exact=model===STAGE_NATIVE_MODEL.replace(/^openrouter\//,"");
   provider=p?.[1]==="openrouter";
   fall=false;tools=false;isolated=false; // Hermes native toolsets/fallbacks not yet certified
 }
 if(dirs&&agentId==="openclaw"){
   const text=await readBoundedStageFile(path.join(ownHome,"openclaw.json"));
   try{
     const doc=JSON.parse(text||"") as {
       agents?:{defaults?:{model?:{primary?:string;fallbacks?:unknown}},list?:Array<{
         id?:string;model?:string;workspace?:string;agentDir?:string
       }>};
       tools?:{deny?:unknown}
     };
     const def=doc.agents?.defaults?.model;
     const target=doc.agents?.list?.find(a=>a.id==="mission-control");
     model=target?.model??def?.primary??null;
     exact=model===STAGE_NATIVE_MODEL&&def?.primary===STAGE_NATIVE_MODEL;
     provider=exact;
     fall=Array.isArray(def?.fallbacks)&&def?.fallbacks.length===0;
     tools=Array.isArray(doc.tools?.deny)&&doc.tools!.deny.length===1&&doc.tools!.deny[0]==="*";
     isolated=target?.agentDir===path.join(ownHome,"agents","mission-control")&&
       target?.workspace===path.join(ownHome,"workspace-mission-control")&&
       process.env.OPENCLAW_STATE_DIR===ownHome;
   }catch{ /* malformed stage config is denied */ }
 }
 const price=(stage&&dirs)?await catalog():null;
 const free=price?.status==="CATALOG_SAFE_TEXT_ONLY"&&
   price?.code==="CATALOG_TEXT_PRICE_ZERO"&&price.requestedModel===STAGE_NATIVE_MODEL.replace(/^openrouter\//,"");
 const evidence:StageFreeEvidence={
  stage,stageSession:/^acf-werkplaats-[A-Za-z0-9_-]{1,48}$/.test(sessionKey),
  profileIsolated:Boolean(dirs),nativeModelExact:exact,providerExact:provider,
  fallbackEmpty:fall,nativeToolsDisabled:tools,stageCredential:credential,
  transportIsolated:isolated,catalogTextFree:Boolean(free),extraToolFeesDisabled:tools,
 };
 const decision=assessStageNativeFree(evidence);
 // Distinguish a not-proven Hermes native fallback/tool default from a
 // fallback known to be nonempty. No rewrite of this decision to READY.
 const truthful=agentId==="hermes"&&dirs&&exact&&provider&&(!fall||!tools||!isolated)
   ?{canSend:false,code:"HERMES_NATIVE_POLICY_UNVERIFIED" as const}:decision;
 return {agentId,stageSource:"STAGE_NATIVE_PROFILE_AND_OFFICIAL_CATALOG",costMode:"FREE_ONLY",
  configuredModel:model,stageCredentialConfigured:credential,configVerified:Boolean(dirs&&exact&&provider),
  effectiveFallbacks:fall?"NONE":"UNKNOWN_OR_NONEMPTY",toolsVerifiedDisabled:tools,
  gateway:isolated?"EMBEDDED_STAGE":"UNVERIFIED",
  catalogStatus:price?.status??"CATALOG_UNVERIFIED",catalogCode:price?.code??"NO_CATALOG_PROOF",
  checkedAt:price?.checkedAt??null,...truthful,providerCalls:0};
}

/** Called again *inside* the native runner, not just at an HTTP route.
 * Never inherit LIVE provider credentials or HOME in the preview.
 */
export async function stageNativeExecEnvironment(agentId:StageNativeAgent,sessionKey:string):Promise<NodeJS.ProcessEnv>{
 const proof=await inspectNativeStageTransport(agentId,sessionKey);
 if(!proof.canSend)throw new Error("STAGE_NATIVE_FREE_TRANSPORT_NOT_VERIFIED:"+proof.code);
 const secret=await readStageNativeKey();
 if(!secret)throw new Error("STAGE_NATIVE_KEY_NOT_AVAILABLE");
 const home=path.join(process.env.GAOS_STAGE_NATIVE_ROOT!,agentId);
 return {...process.env,HOME:home,
   ...(agentId==="hermes"?{HERMES_HOME:home}:{OPENCLAW_STATE_DIR:home}),
   OPENROUTER_API_KEY:secret,OPENAI_API_KEY:"",ANTHROPIC_API_KEY:"",
   GOOGLE_API_KEY:"",OPENCLAW_GATEWAY_URL:"http://127.0.0.1:9/mc-preview-disabled"};
}
