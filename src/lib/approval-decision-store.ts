import { promises as fs } from "fs";
import path from "path";
import type { RiskLevel } from "@/lib/connectors/types";

const APPROVAL_FILE = path.join(process.cwd(), "data", "approval-decisions.jsonl");

export interface PersistedApprovalDecision {
  approvalId: string;
  connectorId: string;
  requestedCapability: string;
  context: string | null;
  riskLevel: RiskLevel | null;
  requestedAt: string | null;
  status: "approved" | "rejected";
  reason: string;
  decidedAt: string;
  actor: "operator";
}

interface LegacyApprovalDecision {
  key: string;
  agentId: string;
  requestedCapability: string;
  decision: "approved" | "rejected";
  reason: string;
  at: string;
}

const RISK_LEVELS = new Set<RiskLevel>(["low", "medium", "high", "critical"]);

function normalizeDecision(value: unknown): PersistedApprovalDecision | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if (
    typeof record.approvalId === "string" &&
    typeof record.connectorId === "string" &&
    typeof record.requestedCapability === "string" &&
    (record.status === "approved" || record.status === "rejected") &&
    typeof record.decidedAt === "string"
  ) {
    return {
      approvalId: record.approvalId,
      connectorId: record.connectorId,
      requestedCapability: record.requestedCapability,
      context: typeof record.context === "string" ? record.context : null,
      riskLevel: RISK_LEVELS.has(record.riskLevel as RiskLevel) ? (record.riskLevel as RiskLevel) : null,
      requestedAt: typeof record.requestedAt === "string" ? record.requestedAt : null,
      status: record.status,
      reason: typeof record.reason === "string" ? record.reason : "",
      decidedAt: record.decidedAt,
      actor: "operator",
    };
  }

  if (
    typeof record.agentId === "string" &&
    typeof record.requestedCapability === "string" &&
    (record.decision === "approved" || record.decision === "rejected") &&
    typeof record.at === "string"
  ) {
    return {
      approvalId: `legacy:${record.agentId}::${record.requestedCapability}`,
      connectorId: record.agentId,
      requestedCapability: record.requestedCapability,
      context: null,
      riskLevel: null,
      requestedAt: null,
      status: record.decision,
      reason: typeof record.reason === "string" ? record.reason : "",
      decidedAt: record.at,
      actor: "operator",
    };
  }

  return null;
}

function decisionKey(decision: PersistedApprovalDecision): string {
  return `${decision.connectorId}::${decision.requestedCapability}`;
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
      const decision = normalizeDecision(JSON.parse(line) as unknown);
      if (decision) latest.set(decisionKey(decision), decision);
    } catch {
      // One malformed append must not hide the remaining approval history.
    }
  }
  return Array.from(latest.values()).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
}

export async function appendApprovalDecision(decision: PersistedApprovalDecision): Promise<void> {
  await fs.mkdir(path.dirname(APPROVAL_FILE), { recursive: true });
  const legacy: LegacyApprovalDecision = {
    key: decisionKey(decision),
    agentId: decision.connectorId,
    requestedCapability: decision.requestedCapability,
    decision: decision.status,
    reason: decision.reason,
    at: decision.decidedAt,
  };
  await fs.appendFile(
    APPROVAL_FILE,
    `${JSON.stringify(legacy)}\n${JSON.stringify(decision)}\n`,
    "utf8"
  );
}
