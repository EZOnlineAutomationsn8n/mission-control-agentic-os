import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { clearConversation, isValidConversationKey, readConversation } from "@/lib/agent-conversations/store";

export const dynamic = "force-dynamic";
const CLEAR_CONFIRMATION = "CLEAR CONVERSATION";

function validate(agentId: string, sessionId: string): NextResponse | null {
  if (!isValidConversationKey(agentId) || !isValidConversationKey(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid agent or session identifier" }, { status: 400 });
  }
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ agentId: string; sessionId: string }> }) {
  const { agentId, sessionId } = await context.params;
  const invalid = validate(agentId, sessionId);
  if (invalid) return invalid;
  return NextResponse.json({ entries: await readConversation(agentId, sessionId) });
}

export async function DELETE(request: Request, context: { params: Promise<{ agentId: string; sessionId: string }> }) {
  const { agentId, sessionId } = await context.params;
  const invalid = validate(agentId, sessionId);
  if (invalid) return invalid;
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if ((body as { confirmation?: unknown } | null)?.confirmation !== CLEAR_CONFIRMATION) {
    return NextResponse.json({ ok: false, error: `confirmation must equal ${CLEAR_CONFIRMATION}` }, { status: 409 });
  }
  const removed = await clearConversation(agentId, sessionId);
  const audit = await appendAuditEvent({
    timestamp: new Date().toISOString(), connectorId: agentId, actionType: "conversation-clear",
    status: "completed", resultSummary: `session ${sessionId} cleared · ${removed} entries removed`,
  });
  if (!audit.ok) return NextResponse.json({ ok: false, error: `conversation cleared but audit failed: ${audit.error}` }, { status: 500 });
  return NextResponse.json({ ok: true, removed });
}
