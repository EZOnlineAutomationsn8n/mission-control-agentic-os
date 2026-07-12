import { NextResponse } from "next/server";
import {
  appendApprovalDecision,
  readApprovalDecisions,
  type ApprovalDecisionRecord,
} from "@/lib/approval-decisions-store";

// Approval-decision persistence endpoint, project-local file only. Never
// touches a connector, a service, a secret, or any session. GET returns
// the latest decision per stable approval key; POST appends one decision.
export const dynamic = "force-dynamic";

export async function GET() {
  const decisions = await readApprovalDecisions();
  return NextResponse.json({ decisions });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const b = body as Partial<ApprovalDecisionRecord> | null;
  if (
    !b ||
    typeof b.agentId !== "string" ||
    typeof b.requestedCapability !== "string" ||
    (b.decision !== "approved" && b.decision !== "rejected")
  ) {
    return NextResponse.json({ ok: false, error: "missing required decision fields" }, { status: 400 });
  }

  const rec: ApprovalDecisionRecord = {
    key: `${b.agentId}::${b.requestedCapability}`,
    agentId: b.agentId,
    requestedCapability: b.requestedCapability,
    decision: b.decision,
    reason: typeof b.reason === "string" ? b.reason : "",
    at: typeof b.at === "string" ? b.at : new Date().toISOString(),
  };

  const result = await appendApprovalDecision(rec);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
