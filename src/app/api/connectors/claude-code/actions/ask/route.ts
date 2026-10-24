import { NextResponse } from "next/server";
import { promptWithAttachments, resolveAttachments } from "@/lib/attachments/store";
import { executeConversationRequest } from "@/lib/agent-conversations/service";
import { parseConversationInitiator } from "@/lib/agent-conversations/initiator";
import { isValidConversationKey } from "@/lib/agent-conversations/store";
import { runClaudeCodeTurn } from "@/lib/claude-code/runner";
import { stageFccPreDispatchVerdict } from "@/lib/connectors/live/fcc-actions";
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
  const stageGuard=stageFccPreDispatchVerdict();
  if(!stageGuard.canDispatch)return NextResponse.json({error:stageGuard.code,
    detail:"Stage native FCC requires effective guarded transport proof; no model turn or session mutation made"}, {status:409});
  const effectivePrompt = promptWithAttachments(prompt.trim(), attachments);
  const session = await readClaudeCodeSession(sessionId);
  if (!session?.active) return NextResponse.json({ error: "Claude Code session is stopped; start it before sending a prompt" }, { status: 409 });
  if (session.status === "running" || session.status === "starting") {
    return NextResponse.json({ error: "Claude Code session is already busy" }, { status: 409 });
  }

  await updateClaudeCodeSession(sessionId, { status: "running", lastError: null });
  const persisted = await executeConversationRequest({
    agentId: "claude-code", sessionId, prompt: prompt.trim(), attachments, actionType: "claude-code-agent-turn",
    initiator: parsedInitiator.initiator ?? undefined,
    run: () => runClaudeCodeTurn({ session, prompt: effectivePrompt, create: false }),
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
