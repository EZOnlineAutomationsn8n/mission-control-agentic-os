import { NextResponse } from "next/server";
import {
  appendApprovalDecision,
  readApprovalDecisions,
  type PersistedApprovalDecision,
} from "@/lib/approval-decision-store";
import { appendAuditEvent } from "@/lib/audit-log-store";
import type { RiskLevel } from "@/lib/connectors/types";

export const dynamic = "force-dynamic";

const RISK_LEVELS = new Set<RiskLevel>(["low", "medium", "high", "critical"]);

export async function GET(req: Request) {
  const connectorId = new URL(req.url).searchParams.get("connectorId");
  const decisions = await readApprovalDecisions();
  return NextResponse.json({
    decisions: connectorId ? decisions.filter((decision) => decision.connectorId === connectorId) : decisions,
  });
}

export async function POST(req: Request) {
  let body: Partial<PersistedApprovalDecision> | null;
  try {
    body = (await req.json()) as Partial<PersistedApprovalDecision> | null;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body.approvalId !== "string" ||
    typeof body.connectorId !== "string" ||
    typeof body.requestedCapability !== "string" ||
    typeof body.context !== "string" ||
    typeof body.requestedAt !== "string" ||
    !RISK_LEVELS.has(body.riskLevel as RiskLevel) ||
    (body.status !== "approved" && body.status !== "rejected")
  ) {
    return NextResponse.json({ ok: false, error: "invalid approval decision" }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.status === "rejected" && !reason) {
    return NextResponse.json({ ok: false, error: "rejection reason is required" }, { status: 400 });
  }

  const existing = (await readApprovalDecisions()).find((decision) => decision.approvalId === body.approvalId);
  if (existing) {
    return NextResponse.json({ ok: true, decision: existing, alreadyDecided: true });
  }

  const decision: PersistedApprovalDecision = {
    approvalId: body.approvalId,
    connectorId: body.connectorId,
    requestedCapability: body.requestedCapability,
    context: body.context,
    riskLevel: body.riskLevel as RiskLevel,
    requestedAt: body.requestedAt,
    status: body.status,
    reason,
    decidedAt: new Date().toISOString(),
    actor: "operator",
  };

  try {
    await appendApprovalDecision(decision);
    const audit = await appendAuditEvent({
      timestamp: decision.decidedAt,
      connectorId: decision.connectorId,
      actionType: `approval:${decision.requestedCapability}`,
      status: decision.status,
      resultSummary: `${decision.status} — ${decision.reason}`,
    });
    if (!audit.ok) {
      return NextResponse.json(
        { ok: false, error: `approval persisted but audit persistence failed: ${audit.error ?? "unknown error"}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, decision });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "approval persistence failed" },
      { status: 500 }
    );
  }
}
