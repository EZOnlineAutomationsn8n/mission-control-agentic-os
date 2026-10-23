/** ACF Werkplaats: existing registration and model-error proof only. */
export const CLAUDE_AGENT = "claude-code";
export const LEGACY_SESSION = "acf-werkplaats-claude-code";
export const RECOVERY_SESSION = "acf-werkplaats-claude-code-recovery-01";
export const ACF_SESSION_PATTERN = /^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$/;
type Session = {session_ref:string;status:string;verdict:string;reason?:string;last_error?:string|null};
export type RosterAgent = {agent_id:string;route:string;can_join_now:boolean;suggested_session:string|null;sessions:Session[];why_not?:string|null};
export type ErrorProof = {code:string;triedRoutes:number[];triedAliases:string[];detail:string;recoverable:boolean};
export function classifyClaudeError(value:unknown):ErrorProof {
 const raw=typeof value==="string"?value:"";
 const code=/unrecognized_model/i.test(raw)?"CLAUDE_CLI_UNRECOGNIZED_MODEL":
 /all configured model routes failed/i.test(raw)?"FCC_ALL_ROUTES_FAILED":
 /session.{0,60}not found|no conversation found/i.test(raw)?"NATIVE_SESSION_MISSING":
 /429|rate.limit/i.test(raw)?"FCC_RATE_LIMIT":
 /timeout|timed.out|etimedout/i.test(raw)?"TURN_TIMEOUT_UNCERTAIN":
 /fetch failed|econnrefused|enotfound/i.test(raw)?"FCC_TRANSPORT_UNREACHABLE":
 raw?"SESSION_ERROR_UNCLASSIFIED":"NONE";
 const triedAliases=[...new Set((raw.match(/open_router\/[a-z0-9][a-z0-9/_.:-]{0,110}:free|open_router\/openrouter\/free/g)||[]))].slice(0,12);
 const triedRoutes=[...new Set([...raw.matchAll(/\broute(?:Number)?\s*[#:=]?\s*(1[0-2]|[1-9])\b/gi)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
 return {code,triedRoutes,triedAliases,detail:({
  CLAUDE_CLI_UNRECOGNIZED_MODEL:"Claude Code CLI/SDK weigert de synthetische FCC-modelalias.",
  FCC_ALL_ROUTES_FAILED:"Geen succesvolle FCC-completion; individuele pogingen moeten uit bestaand runtimebewijs komen.",
  NATIVE_SESSION_MISSING:"Native Claude-sessie niet hervatbaar; geschiedenis niet overschrijven.",
  FCC_RATE_LIMIT:"Rate limit; geen automatische retry.",TURN_TIMEOUT_UNCERTAIN:"Onbekende beurtuitkomst; geen retry.",
  FCC_TRANSPORT_UNREACHABLE:"FCC-transport onbereikbaar.",NONE:"Geen fout vastgelegd.",
  SESSION_ERROR_UNCLASSIFIED:"Onbekende fout; ruwe fout blijft alleen in beschermd sessiebewijs."
 } as Record<string,string>)[code],recoverable:["CLAUDE_CLI_UNRECOGNIZED_MODEL","FCC_ALL_ROUTES_FAILED","NATIVE_SESSION_MISSING","FCC_TRANSPORT_UNREACHABLE"].includes(code)};
}
export function planClaudeSession(agent:RosterAgent|null) {
 if(!agent||agent.agent_id!==CLAUDE_AGENT||agent.route!=="ENABLED")return {status:"UNKNOWN" as const,sessionRef:null,proof:classifyClaudeError(""),note:"Geen ingeschakelde ACF-registratie"};
 const ready=agent.sessions.find(s=>s.session_ref===agent.suggested_session&&s.verdict==="ELIGIBLE")||
  agent.sessions.find(s=>s.verdict==="ELIGIBLE"&&ACF_SESSION_PATTERN.test(s.session_ref));
 if(ready)return {status:"READY" as const,sessionRef:ready.session_ref,proof:classifyClaudeError(""),note:"ACF meldt ELIGIBLE. Geen start nodig."};
 const old=agent.sessions.find(s=>s.session_ref===LEGACY_SESSION);
 const recovery=agent.sessions.find(s=>s.session_ref===RECOVERY_SESSION);
 const proof=classifyClaudeError((recovery||old)?.last_error||(recovery||old)?.reason);
 if(recovery)return {status:"BLOCKED" as const,sessionRef:recovery.session_ref,proof,note:"Recovery-key bestaat. Geen overwrite of onbegrensde retry."};
 if(old&&["starting","running"].includes(old.status))return {status:"BLOCKED" as const,sessionRef:old.session_ref,proof,note:"Een beurt of sessiestart is mogelijk in uitvoering."};
 return {status:"PREPARE_FRESH" as const,sessionRef:RECOVERY_SESSION,proof,note:"Nieuwe ACF-only sessie; originele key en geschiedenis blijven bestaan."};
}
