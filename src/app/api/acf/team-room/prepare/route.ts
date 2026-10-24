import { NextResponse } from "next/server";
import { readClaudeCodeSession, prepareClaudeAfcStageSession } from "@/lib/claude-code/session-store";
import { validateWerkplaatsOperator } from "@/lib/connectors/live/manus-stage-setup";
import { readAcfTeamRoster } from "@/lib/acf/control-adapter";
import path from "node:path";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"no-store"};
const key = "acf-werkplaats-claude-code";
let preparing = false;

function stageOnly():boolean {
  return process.env.MC_PREVIEW==="1" &&
    process.env.GAOS_STAGE_NATIVE_ISOLATED==="1" &&
    path.resolve(process.cwd()).endsWith("/.stage-achtergrond");
}

/** Existing local registry and ACF roster, not a production status proxy
 * or a price catalog. PREPARED is never misreported as ACF eligible.
 */
export async function GET(){
  if(!stageOnly())return NextResponse.json({ok:false,code:"NOT_ISOLATED_ACF_WERKPLAATS"},{status:403,headers});
  const [session,roster]=await Promise.all([readClaudeCodeSession(key),readAcfTeamRoster()]);
  const list=roster.ok?(roster.answer as {agents?:unknown}).agents:null;
  const agent=(Array.isArray(list)?list:[]).find((a:unknown)=>Boolean(a&&typeof a==="object"&&(a as {agent_id?:string}).agent_id==="claude-code")) as {can_join_now?:boolean}|undefined;
  return NextResponse.json({ok:true,agentId:"claude-code",
    sessionRef:key,registered:Boolean(session),nativeSessionIdPresent:Boolean(session?.claudeSessionId),
    nativeStatus:session?.status??"NOT_REGISTERED",active:session?.active??false,
    acfRosterAvailable:roster.ok,canJoinNow:agent?.can_join_now??false,
    operatorModelRoutes:"EXISTING_FCC_12",bootstrapTurns:0,
    readyForDennisUat:false,dennisUatPass:false}, {headers});
}

export async function POST(request:Request){
  if(!stageOnly())return NextResponse.json({ok:false,code:"NOT_ISOLATED_ACF_WERKPLAATS"},{status:403,headers});
  const unauthorized=await validateWerkplaatsOperator(request);
  if(unauthorized)return NextResponse.json({ok:false,code:unauthorized},{status:403,headers});
  const body=await request.json().catch(()=>null) as {agentId?:unknown;operatorConfirmed?:unknown}|null;
  if(body?.agentId!=="claude-code"||body.operatorConfirmed!==true)
    return NextResponse.json({ok:false,code:"DENNIS_ACTION_REQUIRED"},{status:400,headers});
  if(preparing)return NextResponse.json({ok:false,code:"SESSION_PREPARATION_IN_FLIGHT"},{status:409,headers});
  preparing=true;
  try{
    const session=await prepareClaudeAfcStageSession(key);
    return NextResponse.json({ok:true,agentId:"claude-code",sessionRef:session.sessionKey,
      status:session.status,prepared:session.status==="prepared",
      nativeReady:session.status==="idle",bootstrapTurns:0,
      modelSelection:"OPERATOR_FCC_CONFIG",readyForDennisUat:false,dennisUatPass:false},{headers});
  }catch(error){
    return NextResponse.json({ok:false,code:error instanceof Error?error.message:"STAGE_PREPARE_FAILED"},
      {status:409,headers});
  }finally{preparing=false;}
}
