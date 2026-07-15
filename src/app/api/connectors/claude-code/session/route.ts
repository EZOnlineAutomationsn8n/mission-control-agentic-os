import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { isValidConversationKey } from "@/lib/agent-conversations/store";
import { runClaudeCodeTurn } from "@/lib/claude-code/runner";
import { createClaudeCodeSession, readClaudeCodeSession, stopClaudeCodeSession, updateClaudeCodeSession } from "@/lib/claude-code/session-store";

export const dynamic = "force-dynamic";

function keyFrom(request: Request): string {
  return new URL(request.url).searchParams.get("sessionId") || "operator-default";
}

export async function GET(request: Request) {
  const sessionId = keyFrom(request);
  if (!isValidConversationKey(sessionId)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  return NextResponse.json({ session: await readClaudeCodeSession(sessionId) });
}

export async function POST(request: Request) {
  const sessionId = keyFrom(request);
  if (!isValidConversationKey(sessionId)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const action = (body as { action?: unknown } | null)?.action;

  if (action === "stop") {
    const session = await stopClaudeCodeSession(sessionId);
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(), connectorId: "claude-code", actionType: "claude-code-session-stop",
      status: "completed", resultSummary: session ? `session ${session.claudeSessionId} stopped` : "no active session",
    });
    return NextResponse.json({ session, auditRecorded: audit.ok, auditError: audit.error ?? null });
  }
  if (action !== "start") return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });

  const existing = await readClaudeCodeSession(sessionId);
  if (existing?.active && existing.status !== "stopped") return NextResponse.json({ session: existing, alreadyActive: true });

  const session = await createClaudeCodeSession(sessionId);
  try {
    const bootstrap = await runClaudeCodeTurn({
      session,
      create: true,
      prompt: "Initialize this Mission Control Claude Code session. Read CLAUDE.md and AGENTS.md from the current repository. Report your agent identity, exact working directory, and repository first priority. Do not edit files.",
    });
    const ready = await updateClaudeCodeSession(sessionId, { status: "idle", active: true, lastError: null });
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(), connectorId: "claude-code", actionType: "claude-code-session-start",
      status: "completed", resultSummary: `session ${ready.claudeSessionId} started  ${ready.workspace}`,
    });
    return NextResponse.json({
      session: ready, bootstrap: bootstrap.text, agentIdentity: bootstrap.agentIdentity,
      agentRuntime: bootstrap.agentRuntime, gatewayModelAlias: bootstrap.transportModelAlias ?? null,
      auditRecorded: audit.ok, auditError: audit.error ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claude Code session start failed";
    const failed = await updateClaudeCodeSession(sessionId, { status: "error", active: false, lastError: message });
    await appendAuditEvent({
      timestamp: new Date().toISOString(), connectorId: "claude-code", actionType: "claude-code-session-start",
      status: "failed", resultSummary: message,
    });
    return NextResponse.json({ session: failed, error: message }, { status: 502 });
  }
}
