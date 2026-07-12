import { promises as fs } from "fs";
import path from "path";
import type { RiskLevel } from "@/lib/connectors/types";

const APPROVAL_FILE = path.join(process.cwd(), "data", "approval-decisions.jsonl");

export interface PersistedApprovalDecision {
  approvalId: string;
  connectorId: string;
  requestedCapability: string;
  context: string;
  riskLevel: RiskLevel;
  requestedAt: string;
  status: "approved" | "rejected";
  reason: string;
  decidedAt: string;
  actor: "operator";
}

export async function readApprovalDecisions(): Promise<PersistedApprovalDecision[]> {
  let raw: string;
  try {
    raw = await fs.readFile(APPROVAL_FILE, "utf8");
  } catch {
    return [];
  }

  const latest = new Map<string, PersistedApprovalDecision>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const decision = JSON.parse(line) as PersistedApprovalDecision;
      if (decision.approvalId && (decision.status === "approved" || decision.status === "rejected")) {
        latest.set(decision.approvalId, decision);
      }
    } catch {
      // One malformed append must not hide the remaining approval history.
    }
  }
  return Array.from(latest.values()).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
}

export async function appendApprovalDecision(decision: PersistedApprovalDecision): Promise<void> {
  await fs.mkdir(path.dirname(APPROVAL_FILE), { recursive: true });
  await fs.appendFile(APPROVAL_FILE, `${JSON.stringify(decision)}\n`, "utf8");
}
