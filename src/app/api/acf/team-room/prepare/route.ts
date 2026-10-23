import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { appendAuditEvent } from "@/lib/audit-log-store";
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
export async function GET() {
  if(!await restrictedStage())return NextResponse.json({ok:false,code:"NOT_ISOLATED_ACF_WERKPLAATS"},{status:403,headers});
  return NextResponse.json({ok:true,agentId:CLAUDE_AGENT,...await inspect()},{headers});
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
    if(plan.status!=="PREPARE_FRESH")
      return NextResponse.json({ok:false,...plan},{status:409,headers});
    // This external provider gate must be proven in the ACTUAL current FCC runtime;
    // a route ending in ':free', a health 200, or a checkbox is not evidence.
    if(process.env.MC_ACF_FCC_ZERO_CREDIT_GUARD_CERTIFIED!=="1")
      return NextResponse.json({ok:false,
        ...plan,code:"FCC_FREE_ONLY_GUARD_UNVERIFIED",detail:"Geen modelstart zolang de actuele FCC runtime niet fail-closed gratis is gecertificeerd.",
        attemptedRouteNumbers:[],recoverable:true},{status:409,headers});
    const url=liveOrigin+"/api/connectors/claude-code/session?sessionId="+encodeURIComponent(RECOVERY_SESSION);
    const probe=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(9000)});
    if(!probe.ok)return NextResponse.json({ok:false,code:"MC_SESSION_INDEX_UNAVAILABLE"},{status:503,headers});
    const existing=(await probe.json()) as {session?:{sessionKey?:string;status?:string}|null};
    if(existing.session)return NextResponse.json({ok:false,code:"SESSION_KEY_ALREADY_EXISTS",
      detail:"Recovery key already registered. Never overwrite its native session or history.",
      sessionRef:RECOVERY_SESSION},{status:409,headers});
    // Bounded operator-triggered single start, on the existing MC registry API;
    // no proxy for arbitrary URLs, agent IDs, session keys, verbs or credentials.
    const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"start"}),signal:AbortSignal.timeout(180000)});
    const started=(await response.json()) as {session?:{sessionKey?:string;status?:string};error?:string};
    const proof=classifyClaudeError(started.error);
    await appendAuditEvent({timestamp:new Date().toISOString(),connectorId:"acf-claude-werkplaats",
      actionType:"session-prepare",actor:"operator",
      status:response.ok?"completed":"failed",
      resultSummary:JSON.stringify({sessionRef:RECOVERY_SESSION,code:proof.code,
        triedRoutes:proof.triedRoutes,triedAliases:proof.triedAliases,attempted:1,providerCalls:"operator-initiated"}),
      source:"api/acf/team-room/prepare/route.ts"});
    if(!response.ok)return NextResponse.json({ok:false,code:proof.code,proof,sessionRef:RECOVERY_SESSION,
      detail:"Claude-start mislukt; originele sessie en pogingen blijven geregistreerd. Geen retry."},
      {status:502,headers});
    const updated=await inspect();
    if(updated.status!=="READY"||updated.sessionRef!==RECOVERY_SESSION)
      return NextResponse.json({ok:false,...updated,code:"ACF_REGISTRATION_NOT_ELIGIBLE"},
        {status:409,headers});
    return NextResponse.json({ok:true,prepared:true,...updated},{headers});
  } catch(error) {
    return NextResponse.json({ok:false,code:"PREPARATION_OUTCOME_UNKNOWN",
      detail:error instanceof Error?error.name:"Runtime response unavailable",
      attemptedRouteNumbers:[],recoverable:false},{status:503,headers});
  } finally {preparing=false;}
}
