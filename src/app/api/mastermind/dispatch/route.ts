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
  const idempotencyKey = (body as { idempotencyKey?: unknown } | null)?.idempotencyKey;

  if (typeof message !== "string" || !message.trim() || message.length > 8_000) {
    return NextResponse.json({ error: "message must contain 1 to 8000 characters" }, { status: 400 });
  }
  if (!Array.isArray(requestedTargets) || requestedTargets.length < 1 || requestedTargets.length > TARGETS.length || requestedTargets.some((target) => !isTarget(target))) {
    return NextResponse.json({ error: "targets must contain one or more supported agent IDs" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(sessionId)) {
    return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  }
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(idempotencyKey))) {
    return NextResponse.json({ error: "idempotencyKey, when provided, must be a plain token up to 128 characters" }, { status: 400 });
  }

  // REMEDIATION (Block C, work ownership / duplicate dispatch protection):
  // callers MAY supply idempotencyKey. When they do, a retry with the same
  // key inside the same UTC minute is rejected with 409 instead of firing a
  // second real dispatch. This reuses the audit_events.event_hash unique
  // index (migration 002) that already exists for exactly this purpose; no
  // new table, no second scheduler. The intent event's timestamp is
  // deliberately bucketed to the current minute (not wall-clock-exact) so
  // that byte-identical retries hash identically. Callers that do not send
  // idempotencyKey get the prior, unprotected behavior unchanged.
  let correlationId: string | undefined;
  if (typeof idempotencyKey === "string") {
    correlationId = idempotencyKey;
    const minuteBucket = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const intent = await appendAuditEvent({
      timestamp: minuteBucket,
      connectorId: "mastermind",
      actionType: "mastermind-dispatch-intent",
      status: "intent",
      resultSummary: `idempotencyKey=${idempotencyKey} sessionId=${sessionId} targets=${[...new Set(requestedTargets as DispatchTarget[])].sort().join(",")}`,
      actor: "operator",
      source: "app/api/mastermind/dispatch/route.ts:POST",
      correlationId: idempotencyKey,
    });
    if (intent.ok && intent.inserted === false) {
      return NextResponse.json(
        { error: "duplicate dispatch: an identical idempotencyKey was already dispatched in the current minute window", idempotencyKey },
        { status: 409 }
      );
    }
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
    actor: "operator",
    source: "app/api/mastermind/dispatch/route.ts:POST",
    correlationId,
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
