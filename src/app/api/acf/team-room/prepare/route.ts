import { NextResponse } from "next/server";
import { readOfficialUatCatalog } from "@/lib/acf/official-openrouter-pricing";
import { readFile } from "node:fs/promises";
import { ACF_TEAM_ROOM_ROUTES, readAcfTeamRoster } from "@/lib/acf/control-adapter";
import { CLAUDE_AGENT, LEGACY_SESSION, RECOVERY_SESSION, classifyClaudeError, planClaudeSession,
  type RosterAgent } from "@/lib/acf/werkplaats-session-recovery";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const liveOrigin = "http://127.0.0.1:3330";
let preparing = false;

async function inspect() {
  const roster = await readAcfTeamRoster();
  if (!roster.ok) return {status:"BLOCKED" as const,code:roster.code,note:roster.detail,sessionRef:null,proof:classifyClaudeError(null)};
  const agents = Array.isArray(roster.answer.agents) ? roster.answer.agents as RosterAgent[] : [];
  const agent=agents.find(x=>x.agent_id===CLAUDE_AGENT)||null;
  const plan=planClaudeSession(agent);
  // The ACF roster intentionally trims last_error to 200 chars, often before
  // the SDK's actual [claude-code:unrecognized_model] tail. Use the *existing*
  // session index read, on the fixed same-host URL, and emit only classified
  // error codes and free-only route names. Never surface raw command/env data.
  if (plan.proof.code==="SESSION_ERROR_UNCLASSIFIED" && process.env.MC_PREVIEW==="1") {
    try {
      const response=await fetch(liveOrigin+"/api/cockpit/sessions",{
        cache:"no-store",signal:AbortSignal.timeout(10000),
      });
      if(response.ok) {
        const full=await response.json() as {sessions?:Array<{agentId?:string;sessionId?:string;lastError?:unknown}>};
        const exact=(full.sessions??[]).find(s=>s.agentId===CLAUDE_AGENT &&
          [LEGACY_SESSION,RECOVERY_SESSION].includes(String(s.sessionId??"")));
        if(exact) {
          const proof=classifyClaudeError(exact.lastError);
          if(proof.code!=="NONE") return {...plan,code:proof.code,proof};
        }
      }
    } catch { /* retain ACF's limited source, never turn uncertainty into READY */ }
  }
  return {...plan,code:plan.proof.code};
}
async function restrictedStage():Promise<boolean> {
  if (process.env.MC_PREVIEW!=="1") return false;
  try {
    const routes = JSON.parse(await readFile(ACF_TEAM_ROOM_ROUTES,"utf8")) as {
      session_ref_pattern?:string;session_index?:{base_url?:string;path?:string};
      routes?:Record<string,{enabled?:boolean;base_url?:string}>;
    };
    return routes.session_ref_pattern==="^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$" &&
      routes.session_index?.base_url===liveOrigin &&
      routes.session_index.path==="/api/cockpit/sessions" &&
      routes.routes?.[CLAUDE_AGENT]?.enabled===true &&
      routes.routes?.[CLAUDE_AGENT]?.base_url===liveOrigin;
  } catch {return false;}
}
async function nativeReadiness():Promise<{status:string;registered:boolean;nativeIdPresent:boolean;active:boolean}>{
 try{
   // Existing fixed same-host registry. Never starts/resets a native session.
   const response=await fetch(liveOrigin+"/api/connectors/claude-code/session?sessionId="+
     encodeURIComponent(LEGACY_SESSION),{cache:"no-store",signal:AbortSignal.timeout(8500)});
   if(!response.ok)return {status:"UNAVAILABLE",registered:false,nativeIdPresent:false,active:false};
   const j=await response.json() as {session?:{sessionKey?:string;status?:string;claudeSessionId?:string;active?:boolean}};
   const a=j.session;
   return {status:a?.status??"NOT_REGISTERED",registered:a?.sessionKey===LEGACY_SESSION,
     nativeIdPresent:Boolean(a?.claudeSessionId),active:a?.active===true};
 }catch{return {status:"UNKNOWN",registered:false,nativeIdPresent:false,active:false};}
}
export async function GET() {
  if(!await restrictedStage())return NextResponse.json({ok:false,code:"NOT_ISOLATED_ACF_WERKPLAATS"},{status:403,headers});
  const [plan,catalog,native]=await Promise.all([inspect(),readOfficialUatCatalog(),nativeReadiness()]);
  // Catalog evidence is model-price evidence, not a provider-spend control or
  // an ACF session-state mutation. READY requires a genuinely operable native
  // session and runtime-enforced no-paid-route policy, neither inferred here.
  return NextResponse.json({ok:true,agentId:CLAUDE_AGENT,...plan,
    uatReadiness:plan.status==="READY"&&native.status==="idle"&&native.active?
        "BLOCKED_RUNTIME_COST_ENFORCEMENT_UNVERIFIED":"BLOCKED_NATIVE_SESSION_NOT_IDLE",
    readyForDennisUat:false,dennisUatPass:false,catalog,native}, {headers});
}
export async function POST(request:Request) {
  if(!await restrictedStage())return NextResponse.json({ok:false,code:"NOT_ISOLATED_ACF_WERKPLAATS"},{status:403,headers});
  const body=await request.json().catch(()=>null) as {agentId?:unknown;operatorConfirmed?:unknown}|null;
  if(!body||body.agentId!==CLAUDE_AGENT||body.operatorConfirmed!==true)
    return NextResponse.json({ok:false,code:"DENNIS_ACTION_REQUIRED"},{status:400,headers});
  if(preparing)return NextResponse.json({ok:false,code:"SESSION_PREPARATION_IN_FLIGHT"},{status:409,headers});
  preparing=true;
  try {
    const plan=await inspect();
    if(plan.status==="READY")return NextResponse.json({ok:true,prepared:false,...plan},{headers});
    if(plan.status!=="REPAIR_EXISTING")
      return NextResponse.json({ok:false,...plan,code:"ACF_EXISTING_SESSION_REQUIRED"},
        {status:409,headers});
    // The fixed Free Room key is kept. No extra native session key and no
    // bootstrap prompt. The actual Claude CLI runtime must first prove both:
    // SDK accepted model=sonnet/haiku and FCC route-specific zero pricing.
    // An environment toggle is NOT a price certificate.
    const [catalog,native]=await Promise.all([readOfficialUatCatalog(),nativeReadiness()]);
    const code=catalog.status!=="CATALOG_SAFE_TEXT_ONLY"?
      catalog.code:"ACF_EXISTING_NATIVE_SESSION_ERROR_NOT_STAGED";
    return NextResponse.json({ok:false,...plan,code,
      nativeResumeCertified:false,readyForDennisUat:false,dennisUatPass:false,catalog,native,
      detail:catalog.status!=="CATALOG_SAFE_TEXT_ONLY"?
        "Officiële catalogusprijs kan niet worden gevalideerd: geen providerbeurt gestart.":
        "Officiële tekstmodel- en endpointprijs is nul, maar de bestaande Claude-sessie "+
        "staat niet idle/active en de productie-runtime handhaaft nog geen geverifieerde "+
        "no-paid FCC-only policy. Geen production session-statusmutatie of modelprompt.",
      attemptedRouteNumbers:[],recoverable:true},{status:409,headers});
  } catch(error) {
    return NextResponse.json({ok:false,code:"PREPARATION_OUTCOME_UNKNOWN",
      detail:error instanceof Error?error.name:"Runtime response unavailable",
      attemptedRouteNumbers:[],recoverable:false},{status:503,headers});
  } finally {preparing=false;}
}
