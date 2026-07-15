import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { askCliAgent, changeCliAgentSession } from "@/lib/cli-agents/api";
import type { CliAgentId } from "@/lib/cli-agents/session-store";
import { POST as changeClaudeSession } from "@/app/api/connectors/claude-code/session/route";
import { POST as askClaude } from "@/app/api/connectors/claude-code/actions/ask/route";

export const dynamic = "force-dynamic";

const TARGETS = ["claude-code", "hermes", "agy", "openclaw", "codex", "gemini"] as const;
type DispatchTarget = typeof TARGETS[number];

function isTarget(value: unknown): value is DispatchTarget {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

async function startTarget(target: DispatchTarget, sessionId: string): Promise<Response> {
  const request = new Request(`http://mission-control/api/connectors/${target}/session?sessionId=${sessionId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  });
  return target === "claude-code"
    ? changeClaudeSession(request)
    : changeCliAgentSession(request, target as CliAgentId);
}

async function askTarget(target: DispatchTarget, sessionId: string, message: string): Promise<Response> {
  const request = new Request(`http://mission-control/api/connectors/${target}/actions/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, prompt: message }),
  });
  return target === "claude-code" ? askClaude(request) : askCliAgent(request, target as CliAgentId);
}

async function dispatchOne(target: DispatchTarget, sessionId: string, message: string) {
  const started = await startTarget(target, sessionId);
  const startPayload = await started.json() as { error?: string };
  if (!started.ok) {
    return { target, status: "failed", stage: "start", error: startPayload.error || `session start returned HTTP ${started.status}` };
  }

  const response = await askTarget(target, sessionId, message);
  const payload = await response.json() as {
    status?: string;
    text?: string | null;
    error?: string | null;
    agentIdentity?: string | null;
    agentRuntime?: string | null;
    agentSessionId?: string | null;
    transportModelAlias?: string | null;
    actualRuntimeModel?: string | null;
  };
  return {
    target,
    status: response.ok && payload.status === "completed" ? "completed" : "failed",
    stage: "turn",
    text: payload.text ?? null,
    error: payload.error || (!response.ok ? `agent turn returned HTTP ${response.status}` : null),
    agentIdentity: payload.agentIdentity ?? null,
    agentRuntime: payload.agentRuntime ?? null,
    agentSessionId: payload.agentSessionId ?? null,
    transportModelAlias: payload.transportModelAlias ?? null,
    actualRuntimeModel: payload.actualRuntimeModel ?? null,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const message = (body as { message?: unknown } | null)?.message;
  const requestedTargets = (body as { targets?: unknown } | null)?.targets;
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId ?? "mastermind-operator";

  if (typeof message !== "string" || !message.trim() || message.length > 8_000) {
    return NextResponse.json({ error: "message must contain 1 to 8000 characters" }, { status: 400 });
  }
  if (!Array.isArray(requestedTargets) || requestedTargets.length < 1 || requestedTargets.length > TARGETS.length || requestedTargets.some((target) => !isTarget(target))) {
    return NextResponse.json({ error: "targets must contain one or more supported agent IDs" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(sessionId)) {
    return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  }

  const targets = [...new Set(requestedTargets as DispatchTarget[])];
  const startedAt = Date.now();
  const results = await Promise.all(targets.map((target) => dispatchOne(target, sessionId, message.trim())));
  const completed = results.filter((result) => result.status === "completed").length;
  const status = completed === results.length ? "completed" : completed > 0 ? "partial" : "failed";
  const audit = await appendAuditEvent({
    timestamp: new Date().toISOString(),
    connectorId: "mastermind",
    actionType: "multi-agent-dispatch",
    status,
    resultSummary: `${completed}/${results.length} agent turns completed for session ${sessionId}`,
  });

  return NextResponse.json({
    status,
    sessionId,
    durationMs: Date.now() - startedAt,
    completed,
    total: results.length,
    results,
    auditRecorded: audit.ok,
    auditError: audit.error ?? null,
  });
}
