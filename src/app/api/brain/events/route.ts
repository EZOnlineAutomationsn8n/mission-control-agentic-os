import { NextResponse } from "next/server";
import { appendBrainEvent, listBrainEvents } from "@/lib/shared-brain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ events: await listBrainEvents() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "brain event read failed" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    if (!summary) return NextResponse.json({ error: "Event summary is required" }, { status: 400 });
    const evidence = Array.isArray(body.evidence)
      ? body.evidence.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      : [];
    const event = await appendBrainEvent({
      actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "operator",
      eventType: typeof body.eventType === "string" && body.eventType.trim() ? body.eventType.trim() : "state-update",
      scope: typeof body.scope === "string" && body.scope.trim() ? body.scope.trim() : "mission-control",
      summary,
      evidence,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "brain event append failed" }, { status: 503 });
  }
}
