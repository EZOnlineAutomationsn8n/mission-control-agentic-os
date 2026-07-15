import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { promptWithAttachments, resolveAttachments } from "@/lib/attachments/store";
import { executeConversationRequest, type ConnectorConversationResult } from "@/lib/agent-conversations/service";
import { isValidConversationKey } from "@/lib/agent-conversations/store";
import { runAgyTurn } from "./agy-runner";
import { runHermesTurn } from "./hermes-runner";
import { runOpenClawTurn } from "./openclaw-runner";
import { runGeminiTurn } from "./gemini-runner";
import { runCodexTurn } from "./codex-runner";
import {
  createCliAgentSession,
  readCliAgentSession,
  stopCliAgentSession,
  updateCliAgentSession,
  type CliAgentId,
  type CliAgentSession,
} from "./session-store";

const LABELS: Record<CliAgentId, string> = {
  hermes: "Hermes Agent",
  openclaw: "OpenClaw",
  agy: "Antigravity",
  gemini: "Gemini CLI",
  codex: "Codex CLI",
};

function sessionKey(request: Request): string {
  return new URL(request.url).searchParams.get("sessionId") || "operator-default";
}

async function runAgentTurn(agentId: CliAgentId, session: CliAgentSession, prompt: string, create: boolean): Promise<ConnectorConversationResult> {
  if (agentId === "hermes") return runHermesTurn({ session, prompt, create });
  if (agentId === "agy") return runAgyTurn({ session, prompt, create });
  if (agentId === "gemini") return runGeminiTurn({ session, prompt, create });
  if (agentId === "codex") return runCodexTurn({ session, prompt, create });
  return runOpenClawTurn({ session, prompt });
}

export async function getCliAgentSession(request: Request, agentId: CliAgentId) {
  const key = sessionKey(request);
  if (!isValidConversationKey(key)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  return NextResponse.json({ session: await readCliAgentSession(agentId, key) });
}

export async function changeCliAgentSession(request: Request, agentId: CliAgentId) {
  const key = sessionKey(request);
  if (!isValidConversationKey(key)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const action = (body as { action?: unknown } | null)?.action;

  if (action === "stop") {
    const session = await stopCliAgentSession(agentId, key);
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(),
      connectorId: agentId,
      actionType: `${agentId}-session-stop`,
      status: "completed",
      resultSummary: session ? `session ${session.runtimeSessionId} stopped` : "no active session",
    });
    return NextResponse.json({ session, auditRecorded: audit.ok, auditError: audit.error ?? null });
  }
  if (action !== "start") return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });

  const existing = await readCliAgentSession(agentId, key);
  if (existing?.active && existing.status !== "stopped") return NextResponse.json({ session: existing, alreadyActive: true });

  const session = await createCliAgentSession(agentId, key);
  try {
    const bootstrapPrompt = `Initialize this Mission Control ${LABELS[agentId]} session. Report your agent identity and exact workspace. Do not edit files or use tools.`;
    const bootstrap = await runAgentTurn(agentId, session, bootstrapPrompt, true);
    if (bootstrap.status !== "completed" || !bootstrap.text || !bootstrap.agentSessionId) {
      throw new Error(bootstrap.error || `${LABELS[agentId]} bootstrap did not complete`);
    }
    const ready = await updateCliAgentSession(agentId, key, {
      runtimeSessionId: bootstrap.agentSessionId,
      status: "idle",
      active: true,
      lastError: null,
    });
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(),
      connectorId: agentId,
      actionType: `${agentId}-session-start`,
      status: "completed",
      resultSummary: `session ${ready.runtimeSessionId} started - ${ready.workspace}`,
    });
    return NextResponse.json({
      session: ready,
      bootstrap: bootstrap.text,
      agentIdentity: bootstrap.agentIdentity,
      agentRuntime: bootstrap.agentRuntime,
      transportModelAlias: bootstrap.transportModelAlias ?? null,
      actualRuntimeModel: bootstrap.actualRuntimeModel ?? null,
      auditRecorded: audit.ok,
      auditError: audit.error ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${LABELS[agentId]} session start failed`;
    const failed = await updateCliAgentSession(agentId, key, { status: "error", active: false, lastError: message });
    await appendAuditEvent({
      timestamp: new Date().toISOString(),
      connectorId: agentId,
      actionType: `${agentId}-session-start`,
      status: "failed",
      resultSummary: message,
    });
    return NextResponse.json({ session: failed, error: message }, { status: 502 });
  }
}

export async function askCliAgent(request: Request, agentId: CliAgentId) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  const key = (body as { sessionId?: unknown } | null)?.sessionId ?? "operator-default";
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "prompt must be non-empty text" }, { status: 400 });
  if (typeof key !== "string" || !isValidConversationKey(key)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  let attachments;
  try {
    attachments = await resolveAttachments({
      agentId,
      sessionId: key,
      ids: (body as { attachments?: unknown } | null)?.attachments,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid attachments" }, { status: 400 });
  }
  const effectivePrompt = promptWithAttachments(prompt.trim(), attachments);

  const session = await readCliAgentSession(agentId, key);
  if (!session?.active) return NextResponse.json({ error: `${LABELS[agentId]} session is stopped; start it before sending a prompt` }, { status: 409 });
  if (session.status === "running" || session.status === "starting") {
    return NextResponse.json({ error: `${LABELS[agentId]} session is already busy` }, { status: 409 });
  }

  await updateCliAgentSession(agentId, key, { status: "running", lastError: null });
  const persisted = await executeConversationRequest({
    agentId,
    sessionId: key,
    prompt: prompt.trim(),
    attachments,
    actionType: `${agentId}-agent-turn`,
    run: () => runAgentTurn(agentId, session, effectivePrompt, false),
  });
  await updateCliAgentSession(agentId, key, {
    runtimeSessionId: persisted.entry.agentSessionId ?? session.runtimeSessionId,
    status: persisted.entry.status === "completed" ? "idle" : "error",
    lastError: persisted.entry.error,
  });
  return NextResponse.json(
    { ...persisted.entry, auditRecorded: persisted.auditRecorded, auditError: persisted.auditError },
    { status: persisted.auditRecorded ? 200 : 500 }
  );
}
