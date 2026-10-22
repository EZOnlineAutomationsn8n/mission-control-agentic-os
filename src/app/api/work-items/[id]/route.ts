import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { transitionOperatorWorkItem, type WorkStage } from "@/lib/operator-work";

const STAGES = new Set<WorkStage>(["capture", "human-gate", "execute", "shipped"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (!STAGES.has(body.stage as WorkStage)) {
      return NextResponse.json({ error: "Valid lifecycle stage is required" }, { status: 400 });
    }
    const item = await transitionOperatorWorkItem(id, body.stage as WorkStage);
    await appendAuditEvent({
      timestamp: item.updatedAt,
      connectorId: item.assignedAgentId ?? "operator",
      actionType: `work-item:${item.id}`,
      status: item.stage,
      resultSummary: item.stage === "execute" ? `Human gate released: ${item.title}` : item.title,
      actor: "operator",
      source: "app/api/work-items/[id]/route.ts:PATCH",
    });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "work item transition failed";
    return NextResponse.json({ error: message }, { status: message === "Work item not found" ? 404 : 409 });
  }
}
