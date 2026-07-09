import { NextResponse } from "next/server";
import { appendAuditEvent, readAuditEvents, type PersistedAuditEvent } from "@/lib/audit-log-store";

// Read-only + append-only audit endpoint, project-local file only. Never
// touches a connector, a service, a secret, or a tmux/agent session.
export const dynamic = "force-dynamic";

export async function GET() {
  const events = await readAuditEvents();
  return NextResponse.json({ events });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const b = body as Partial<PersistedAuditEvent> | null;
  if (!b || typeof b.connectorId !== "string" || typeof b.actionType !== "string" || typeof b.status !== "string") {
    return NextResponse.json({ ok: false, error: "missing required audit fields" }, { status: 400 });
  }

  const entry: PersistedAuditEvent = {
    timestamp: typeof b.timestamp === "string" ? b.timestamp : new Date().toISOString(),
    connectorId: b.connectorId,
    actionType: b.actionType,
    status: b.status,
    resultSummary: typeof b.resultSummary === "string" ? b.resultSummary : "",
  };

  const result = await appendAuditEvent(entry);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
