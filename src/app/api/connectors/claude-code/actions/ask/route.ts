import { NextResponse } from "next/server";
import { validateRecoveryOperator } from "@/lib/claude-code/recovery-operator-auth";
import { promptWithAttachments, resolveAttachments } from "@/lib/attachments/store";
import { executeConversationRequest } from "@/lib/agent-conversations/service";
import { parseConversationInitiator } from "@/lib/agent-conversations/initiator";
import { isValidConversationKey } from "@/lib/agent-conversations/store";
import { runClaudeCodeTurn } from "@/lib/claude-code/runner";
import { isExistingSharedClaudeBinding, existingClaudeOwnerAsk } from "@/lib/claude-code/werkplaats-existing-executor";
import { readClaudeCodeSession, updateClaudeCodeSession } from "@/lib/claude-code/session-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId ?? "operator-default";
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "prompt must be non-empty text" }, { status: 400 });
  if (typeof sessionId !== "string" || !isValidConversationKey(sessionId)) {
    return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  }
  const parsedInitiator = parseConversationInitiator((body as { initiator?: unknown } | null)?.initiator);
  if (!parsedInitiator.ok) return NextResponse.json({ error: parsedInitiator.error }, { status: 400 });
  let attachments;
  try {
    attachments = await resolveAttachments({
      agentId: "claude-code",
      sessionId,
      ids: (body as { attachments?: unknown } | null)?.attachments,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid attachments" }, { status: 400 });
  }
  const effectivePrompt = promptWithAttachments(prompt.trim(), attachments);
  if (isExistingSharedClaudeBinding(sessionId)) {
    // Preview uploads are stored in a different data tree. Never cross-load
    // those local attachment IDs through the shared native executor.
    if (attachments.length)
      return NextResponse.json({error:"CLAUDE_SHARED_EXECUTOR_ATTACHMENTS_NOT_CROSS_BOUND"},
        {status:409});
    return existingClaudeOwnerAsk(JSON.stringify({
      sessionId, prompt:prompt.trim(),
      initiator:(body as {initiator?:unknown}|null)?.initiator,
    }));
  }
  const session = await readClaudeCodeSession(sessionId);
  if(session?.recoveryHold === true){
    // R2 hold release: exactly ONE operator-initiated resume of the SAME native UUID.
    // No bootstrap, no --session-id, no new UUID, never a second attempt.
    if((body as {recoveryResume?:unknown}|null)?.recoveryResume!==true)
      return NextResponse.json({error:"CLAUDE_R2_RECOVERY_HOLD_USE_RECOVERY_RESUME",
        modelCalls:0,sessionPreserved:true},{status:409});
    const unauthorized=await validateRecoveryOperator(request);
    if(unauthorized)return NextResponse.json({error:unauthorized,modelCalls:0},{status:403});
    if(session.status!=="prepared"||session.active!==true||session.recoveryTurnStartedAt)
      return NextResponse.json({error:"CLAUDE_R2_RECOVERY_TURN_ALREADY_ATTEMPTED_NO_RETRY",
        sessionStatus:session.status,modelCalls:0},{status:409});
    if(attachments.length)
      return NextResponse.json({error:"CLAUDE_R2_RECOVERY_TURN_NO_ATTACHMENTS",modelCalls:0},{status:400});
    const marked=await updateClaudeCodeSession(sessionId,{status:"running",
      recoveryTurnStartedAt:new Date().toISOString()});
    if(marked.claudeSessionId!==session.claudeSessionId)
      return NextResponse.json({error:"CLAUDE_R2_NATIVE_UUID_CHANGED_NO_DISPATCH",modelCalls:0},{status:409});
    const persisted = await executeConversationRequest({
      agentId:"claude-code", sessionId, prompt:prompt.trim(), attachments:[],
      actionType:"claude-code-r2-recovery-resume-turn",
      initiator: parsedInitiator.initiator ?? undefined,
      run: () => runClaudeCodeTurn({ session, prompt: effectivePrompt, create:false }),
    });
    const sameUuid=!persisted.entry.agentSessionId||persisted.entry.agentSessionId===session.claudeSessionId;
    const recovered=persisted.entry.status==="completed"&&sameUuid;
    await updateClaudeCodeSession(sessionId, recovered
      ? {status:"idle",active:true,lastError:null,recoveryHold:false}
      : {status:"error",active:false,
         lastError:persisted.entry.error??(sameUuid?"CLAUDE_R2_RESUME_FAILED":"CLAUDE_R2_RESUME_RETURNED_FOREIGN_UUID")});
    return NextResponse.json({...persisted.entry,recovered,nativeUuidPreserved:sameUuid,
      auditRecorded:persisted.auditRecorded,auditError:persisted.auditError},
      {status:persisted.auditRecorded?200:500});
  }
  if (!session?.active) return NextResponse.json({ error: "Claude Code session is stopped; start it before sending a prompt" }, { status: 409 });
  if (session.status === "running" || session.status === "starting") {
    return NextResponse.json({ error: "Claude Code session is already busy" }, { status: 409 });
  }

  await updateClaudeCodeSession(sessionId, { status: "running", lastError: null });
  const persisted = await executeConversationRequest({
    agentId: "claude-code", sessionId, prompt: prompt.trim(), attachments, actionType: "claude-code-agent-turn",
    initiator: parsedInitiator.initiator ?? undefined,
    run: () => runClaudeCodeTurn({ session, prompt: effectivePrompt,
      create: process.env.MC_PREVIEW==="1" && session.status==="prepared" }),
  });
  await updateClaudeCodeSession(sessionId, {
    status: persisted.entry.status === "completed" ? "idle" : "error",
    lastError: persisted.entry.error,
  });
  return NextResponse.json(
    { ...persisted.entry, auditRecorded: persisted.auditRecorded, auditError: persisted.auditError },
    { status: persisted.auditRecorded ? 200 : 500 }
  );
}
