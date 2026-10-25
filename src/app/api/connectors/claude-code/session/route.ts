import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { isValidConversationKey } from "@/lib/agent-conversations/store";
import { auditInitiatorFields, parseConversationInitiator } from "@/lib/agent-conversations/initiator";
import { runClaudeCodeTurn } from "@/lib/claude-code/runner";
import { createClaudeCodeSession, prepareClaudeAfcStageSession, readClaudeCodeSession, stopClaudeCodeSession, updateClaudeCodeSession } from "@/lib/claude-code/session-store";
import { classifyClaudeError, ACF_SESSION_PATTERN } from "@/lib/acf/werkplaats-session-recovery";
import { FALLBACK_MODEL_ROUTES } from "@/lib/connectors/live/fcc-actions";
import {validateWerkplaatsOperator} from "@/lib/connectors/live/manus-stage-setup";
import { readFirstTurnReadiness } from "@/lib/acf/first-turn-readiness";

export const dynamic = "force-dynamic";

function keyFrom(request: Request): string {
  return new URL(request.url).searchParams.get("sessionId") || "operator-default";
}

export async function GET(request: Request) {
  const sessionId = keyFrom(request);
  if (!isValidConversationKey(sessionId)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  const session=await readClaudeCodeSession(sessionId);
  const firstTurnReadiness=session ? await readFirstTurnReadiness({
    agentId:"claude-code",sessionId,status:session.status,active:session.active,
  }) : null;
  return NextResponse.json({session,...(firstTurnReadiness?{firstTurnReadiness}:{})});
}

export async function POST(request: Request) {
  const sessionId = keyFrom(request);
  if (!isValidConversationKey(sessionId)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const action = (body as { action?: unknown } | null)?.action;
  const parsedInitiator = parseConversationInitiator((body as { initiator?: unknown } | null)?.initiator);
  if (!parsedInitiator.ok) return NextResponse.json({ error: parsedInitiator.error }, { status: 400 });
  const initiator = parsedInitiator.initiator;

  if (action === "prepare-stage") {
    if(process.env.MC_PREVIEW!=="1"||sessionId!=="acf-werkplaats-claude-code")
      return NextResponse.json({error:"STAGE_PREPARE_NOT_ALLOWED"},{status:403});
    const unauthorized=await validateWerkplaatsOperator(request);
    if(unauthorized)return NextResponse.json({error:unauthorized},{status:403});
    try{
      const session=await prepareClaudeAfcStageSession(sessionId);
      return NextResponse.json({session,nativeReady:false,
        operatorModels:"EXISTING_FCC_ROUTES",bootstrapTurns:0});
    }catch(error){
      return NextResponse.json({error:error instanceof Error?error.message:"PREPARE_FAILED"},{status:409});
    }
  }
  if (action === "stop") {
    const session = await stopClaudeCodeSession(sessionId);
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(), connectorId: "claude-code", actionType: "claude-code-session-stop",
      status: "completed", resultSummary: session ? `session ${session.claudeSessionId} stopped` : "no active session",
      ...auditInitiatorFields(initiator),
      source: "claude-code/session/route.ts:POST",
    });
    return NextResponse.json({ session, auditRecorded: audit.ok, auditError: audit.error ?? null });
  }
  if (action !== "start") return NextResponse.json({ error: "action must be start, stop or prepare-stage" }, { status: 400 });

  if(process.env.MC_PREVIEW==="1"){
    if(process.env.GAOS_STAGE_NATIVE_ISOLATED!=="1" ||
      sessionId!=="acf-werkplaats-claude-code")
      return NextResponse.json({error:"CLAUDE_STAGE_ISOLATION_OR_SESSION_INVALID"},{status:409});
    const prepared=await prepareClaudeAfcStageSession(sessionId);
    return NextResponse.json({session:prepared,prepared:true,bootstrapTurns:0,
      requiresFirstOperatorMessage:prepared.status==="prepared",firstTurnByOperator:true});
  }
  const existing = await readClaudeCodeSession(sessionId);
  if (existing?.active && existing.status !== "stopped") return NextResponse.json({ session: existing, alreadyActive: true });
  // Fail closed on the ACF-only key: an old ERROR session is never replaced by
  // a fresh native UUID. The isolated ACF preparation path uses a distinct
  // bounded recovery key, leaving original transcripts and error history intact.
  if (ACF_SESSION_PATTERN.test(sessionId) && existing) {
    return NextResponse.json({ error: "ACF_SESSION_EXISTS_NO_OVERWRITE",
      detail: "Existing ACF session/history cannot be overwritten or retried implicitly.",
      session: existing }, { status: 409 });
  }

  const session = await createClaudeCodeSession(sessionId);
  let routeProof: {routeCount:number;attempts:Array<{routeNumber:number|null;transportModelAlias:string;outcome:string;errorCode:string;latencyMs:number|null}>;skippedRouteNumbers:number[]} | null = null;
  try {
    const bootstrap = await runClaudeCodeTurn({
      // Session preparation is read-only: plan mode permits inspection but does
      // not grant the bootstrap turn automatic file mutation authority. The
      // durable session itself retains its existing acceptEdits contract.
      session: { ...session, permissionMode: "plan" },
      create: true,
      prompt: "Initialize this Mission Control Claude Code session. Read CLAUDE.md and AGENTIC_OS_BUILD_POLICY.md from the current repository. Do not load runtime-specific AGENTS.md unless the current Dennis work order explicitly names it. Report your agent identity, exact working directory, repository first priority, and continuous-execution return conditions. Do not edit files.",
    });
    routeProof = {
      routeCount: bootstrap.routeCount ?? FALLBACK_MODEL_ROUTES.length,
      attempts: (bootstrap.attempts ?? []).filter(a=>FALLBACK_MODEL_ROUTES.includes(a.transportModelAlias)).map(a=>({
        routeNumber:a.routeNumber??null,transportModelAlias:a.transportModelAlias,outcome:a.outcome,
        errorCode:classifyClaudeError(a.error).code,latencyMs:a.latencyMs??null,
      })),
      skippedRouteNumbers:bootstrap.skippedRouteNumbers??[],
    };
    if (bootstrap.status !== "completed" || !bootstrap.text || !bootstrap.agentSessionId) {
      throw new Error(bootstrap.error || "Claude Code bootstrap did not complete");
    }
    const ready = await updateClaudeCodeSession(sessionId, { status: "idle", active: true, lastError: null });
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(), connectorId: "claude-code", actionType: "claude-code-session-start",
      status: "completed", resultSummary: `session ${ready.claudeSessionId} started  ${ready.workspace}`,
      ...auditInitiatorFields(initiator),
      source: "claude-code/session/route.ts:POST",
    });
    return NextResponse.json({
      session: ready, bootstrap: bootstrap.text, agentIdentity: bootstrap.agentIdentity,
      agentRuntime: bootstrap.agentRuntime, gatewayModelAlias: bootstrap.transportModelAlias ?? null,
      auditRecorded: audit.ok, auditError: audit.error ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claude Code session start failed";
    const failed = await updateClaudeCodeSession(sessionId, { status: "error", active: false, lastError: message });
    if (routeProof) await appendAuditEvent({
      timestamp: new Date().toISOString(), connectorId:"claude-code", actionType:"claude-code-session-start-route-proof",
      status:"failed", resultSummary:JSON.stringify({sessionId,code:classifyClaudeError(message).code,...routeProof}),
      ...auditInitiatorFields(initiator), source:"claude-code/session/route.ts:POST",
    });
    await appendAuditEvent({
      timestamp: new Date().toISOString(), connectorId: "claude-code", actionType: "claude-code-session-start",
      status: "failed", resultSummary: message,
      ...auditInitiatorFields(initiator),
      source: "claude-code/session/route.ts:POST",
    });
    return NextResponse.json({ session: failed, error: message }, { status: 502 });
  }
}
