import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { createOperatorWorkItem, listOperatorWorkItems } from "@/lib/operator-work";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ items: await listOperatorWorkItems() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "work item read failed" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Work item title is required" }, { status: 400 });
    const item = await createOperatorWorkItem({
      title,
      description: typeof body.description === "string" ? body.description.trim() : "",
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      assignedAgentId: typeof body.assignedAgentId === "string" ? body.assignedAgentId : null,
    });
    await appendAuditEvent({
      timestamp: item.createdAt,
      connectorId: item.assignedAgentId ?? "operator",
      actionType: `work-item:${item.id}`,
      status: "captured",
      resultSummary: item.title,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "work item create failed" }, { status: 503 });
  }
}
