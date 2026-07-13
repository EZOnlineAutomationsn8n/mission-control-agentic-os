import { NextResponse } from "next/server";
import { sendFccControlledPrompt, FCC_ROUTE_COUNT } from "@/lib/connectors/live/fcc-actions";
import { executeConversationRequest } from "@/lib/agent-conversations/service";
import { isValidConversationKey } from "@/lib/agent-conversations/store";

// Controlled-action endpoint for FCC / OwlAlpha only. Only ever invoked by
// an explicit POST from the operator's UI form submission — nothing polls
// or schedules calls to this route. No shell execution, no filesystem
// writes, no service mutation happen here or in the reader it calls.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const timestamp = new Date().toISOString();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        status: "failed",
        text: null,
        error: "invalid JSON body",
        transportModelAlias: "open_router/openrouter/owl-alpha",
        actualRuntimeModel: null,
        attempts: [],
        routeCount: FCC_ROUTE_COUNT,
        skippedRouteNumbers: [],
        timestamp,
      },
      { status: 400 }
    );
  }

  const prompt = (body as { prompt?: unknown; sessionId?: unknown } | null)?.prompt;
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId ?? "default";
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ status: "failed", text: null, error: "prompt must be non-empty text" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || !isValidConversationKey(sessionId)) {
    return NextResponse.json({ status: "failed", text: null, error: "invalid session identifier" }, { status: 400 });
  }
  const persisted = await executeConversationRequest({
    agentId: "claude-fcc", sessionId, prompt: prompt.trim(), actionType: "fcc-ask",
    run: () => sendFccControlledPrompt(prompt),
  });
  return NextResponse.json({ ...persisted.entry, auditRecorded: persisted.auditRecorded, auditError: persisted.auditError }, {
    status: persisted.auditRecorded ? 200 : 500,
  });
}
