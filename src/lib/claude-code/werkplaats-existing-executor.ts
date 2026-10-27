/**
 * Existing AGENTS MODE Claude executor affinity, NOT a second agent runtime.
 *
 * Only the pre-existing ACF Werkplaats Claude key can use the same owner
 * as its ACF participant route (the existing Mission Control :3330 executor).
 * Never create/start/stop/clear a native session through this read/ask binding.
 * No fallback route or provider configuration is chosen here.
 */
export const WORKPLACE_CLAUDE_KEY = "acf-werkplaats-claude-code";
export function isExistingSharedClaudeBinding(sessionId: string): boolean {
  return process.env.MC_PREVIEW === "1" &&
    process.env.GAOS_STAGE_NATIVE_ISOLATED !== "1" &&
    sessionId === WORKPLACE_CLAUDE_KEY;
}
const OWNER = "http://shared-agentic-sandbox:3330";
export type SharedClaudeKind = "session" | "history" | "ask";
export function sharedClaudeOwnerUrl(kind: SharedClaudeKind): string {
  switch (kind) {
    case "session": return OWNER + "/api/connectors/claude-code/session?sessionId=" + WORKPLACE_CLAUDE_KEY;
    case "history": return OWNER + "/api/agent-conversations/claude-code/" + WORKPLACE_CLAUDE_KEY;
    case "ask": return OWNER + "/api/connectors/claude-code/actions/ask";
  }
}
export function canSendToExistingClaudeOwner(session: {
  sessionKey?: string; status?: string; active?: boolean;
} | null, eligible: boolean): boolean {
  return !!session && session.sessionKey === WORKPLACE_CLAUDE_KEY &&
    session.active === true && session.status === "idle" && eligible;
}
export async function existingClaudeOwnerGet(kind: "session"|"history"): Promise<Response> {
  try {
    const upstream = await fetch(sharedClaudeOwnerUrl(kind),{
      method: "GET", cache: "no-store", redirect:"error", signal:AbortSignal.timeout(15000),
    });
    return new Response(await upstream.text(),{
      status:upstream.status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
    });
  }catch {
    return Response.json({error:"EXISTING_CLAUDE_EXECUTOR_UNREACHABLE"},{status:503});
  }
}
/** No arbitrary prompts are transmitted before REAL ACF eligibility.
 * The actual operator request is forwarded exactly once; never retry unknown
 * provider outcomes. The real executor continues to own audit and history.
 */
export async function existingClaudeOwnerAsk(body: string): Promise<Response> {
  try {
    const read=await fetch(sharedClaudeOwnerUrl("session"),{
      method:"GET",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000),
    });
    if(!read.ok)return Response.json({error:"CLAUDE_SESSION_OWNER_NOT_READY"},{status:409});
    const {session}=await read.json() as {session?: {sessionKey?:string;status?:string;active?:boolean}};
    const r=await fetch(OWNER+"/api/acf/team-room/roster",{
      method:"GET",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000),
    });
    if(!r.ok)return Response.json({error:"CLAUDE_ACF_ADMISSION_UNVERIFIED"},{status:409});
    const roster=await r.json() as {agents?:Array<{agent_id?:string;can_join_now?:boolean;suggested_session?:string|null}>};
    const eligible=roster.agents?.some(x=>x.agent_id==="claude-code" &&
      x.can_join_now===true && x.suggested_session===WORKPLACE_CLAUDE_KEY)===true;
    if(!canSendToExistingClaudeOwner(session??null,eligible))
      return Response.json({error:"CLAUDE_NATIVE_REPLY_NOT_YET_PROVEN_NO_AUTO_DISPATCH"},{status:409});
    const upstream=await fetch(sharedClaudeOwnerUrl("ask"),{
      method:"POST",headers:{"Content-Type":"application/json"},body,
      cache:"no-store",redirect:"error",signal:AbortSignal.timeout(270000),
    });
    return new Response(await upstream.text(),{
      status:upstream.status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
    });
  }catch {
    // A failed POST might have started a native turn. Never repeat it.
    return Response.json({error:"CLAUDE_OWNER_OUTCOME_UNKNOWN_DO_NOT_RETRY"},{status:503});
  }
}
