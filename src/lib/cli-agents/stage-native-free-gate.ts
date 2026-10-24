/** Stage-only native transport pre-dispatch barrier.
 * Reuses the certified public OpenRouter price-check; not a second router.
 * Does not mark a session ELIGIBLE (ACF owns that verdict after a native turn).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
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
 try{const s=await fs.lstat(/* turbopackIgnore: true */ p);return s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0;}
 catch{return false;}
}
async function readBoundedStageFile(p:string,max=16384):Promise<string|null>{
 try{const s=await fs.lstat(/* turbopackIgnore: true */ p);if(!s.isFile()||s.isSymbolicLink()||s.size>max)return null;return await fs.readFile(/* turbopackIgnore: true */ p,"utf8");}
 catch{return null;}
}
/** The installed Hermes source, not an assumed CLI default, defines these
 * semantics. Any source revision changes the signature and fails closed.
 * fallback_config merges both fallback keys; tools_config honors explicit
 * empty CLI lists; model_tools subtracts disabled 'all' at tool granularity.
 * Installed Hermes title_upgrade and compression are explicitly disabled
 * below. This still does NOT certify every external auxiliary or reasoning
 * fee; the effective dispatch gate retains its hard deny.
 */
const HERMES_POLICY_SOURCE_SHA:Record<string,string>={
 "hermes_cli/fallback_config.py":"d593fee4db54c24233a3482de2b5178d3aba62dfea0f8bf4e4613f3a0e8880a3",
 "hermes_cli/tools_config.py":"ee1db982256a787c868f059fbf41d709418e208844181cff598e12ee2db89aa5",
 "hermes_cli/cli_init_mixin.py":"19831c5bb89546fba86f63bacae9eff56c4447143c483197e9209e58ecb1f896",
 "hermes_cli/config_effective.py":"2b04bdd2714fccea19ab169467f1a0f1420c67cd3d0a0d11f79d12f308c8d9a8",
 "model_tools.py":"d0581bcb05ebe0a714a8cf98dd134c8c6c6a516c89816ef5ed13d48d6186afab",
 "toolsets.py":"9b204c4a6b80d9141b9403cb8662031fb3e52430406d2c49a30d78116d440efc",
};
let hermesPolicyCodeCache:{when:number;verified:boolean}|null=null;
async function hermesInstalledPolicySourceVerified():Promise<boolean>{
 if(hermesPolicyCodeCache&&Date.now()-hermesPolicyCodeCache.when<30000)
   return hermesPolicyCodeCache.verified;
 const root="/usr/local/lib/hermes-agent";
 const verified=(await Promise.all(Object.entries(HERMES_POLICY_SOURCE_SHA).map(async([name,expected])=>{
   try{
     const data=await fs.readFile(/* turbopackIgnore: true */ path.join(root,name));
     return createHash("sha256").update(data).digest("hex")===expected;
   }catch{return false;}
 }))).every(Boolean);
 hermesPolicyCodeCache={when:Date.now(),verified};
 return verified;
}
const HERMES_STAGE_CONFIG_SAFE=[
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
 "compression:",
 "  enabled: false",
 "auxiliary:",
 "  title_generation:",
 "    enabled: false",
 "    model_upgrade_enabled: false",
 "memory:",
 "  memory_enabled: false",
 "  user_profile_enabled: false",
].join("\n");
export function hermesExplicitNoFallbackNoToolsConfig(text:string):boolean{
 const normalized=text.split(/\r?\n/).map(line=>line.replace(/\s+$/,""))
   .filter(line=>line.trim()&&!line.trimStart().startsWith("#")).join("\n");
 return normalized===HERMES_STAGE_CONFIG_SAFE;
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
   const pinned=await hermesInstalledPolicySourceVerified();
   const nativePolicy=text!=null&&hermesExplicitNoFallbackNoToolsConfig(text);
   const privateCwd=await regularPrivateDir(path.join(ownHome,"workspace-mission-control"));
   // The observed installed-source hashes + exact isolated config prove no
   // configured fallback routes and no model-exposed toolsets. Other auxiliary
   // external-cost hooks are NOT certified and remain a separate deny gate.
   fall=Boolean(nativePolicy&&pinned);
   tools=Boolean(nativePolicy&&pinned);
   isolated=Boolean(nativePolicy&&pinned&&privateCwd&&process.env.HERMES_HOME===ownHome);
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
  transportIsolated:isolated,catalogTextFree:Boolean(free),
  extraToolFeesDisabled:agentId==="hermes"?false:tools,
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

/** Always execute native stage children in the isolated stage working dir.
 * A legacy session.workspace value is presentation metadata, not authority.
 */
export async function stageNativeExecWorkspace(agentId:StageNativeAgent):Promise<string>{
 const root=process.env.GAOS_STAGE_NATIVE_ROOT||"";
 if(process.env.MC_PREVIEW!=="1"||process.env.GAOS_STAGE_NATIVE_ISOLATED!=="1"||
    !path.isAbsolute(root)||!path.resolve(root).endsWith("/.stage-achtergrond/.preview-native-home"))
   throw new Error("NATIVE_STAGE_WORKSPACE_MODE_UNVERIFIED");
 const own=path.join(root,agentId);
 const cwd=path.join(own,"workspace-mission-control");
 if(!(await regularPrivateDir(root))||!(await regularPrivateDir(own))||
    !(await regularPrivateDir(cwd)))
   throw new Error("NATIVE_STAGE_WORKSPACE_ISOLATION_UNVERIFIED");
 return cwd;
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
