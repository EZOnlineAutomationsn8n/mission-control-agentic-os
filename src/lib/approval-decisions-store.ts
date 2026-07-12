import { promises as fs } from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Append-only persistence for operator approval decisions,
// inside the project directory only (data/approval-decisions.jsonl) — same
// pattern as audit-log-store.ts. Only ever accessed via the
// /api/approvals/decisions route handler.
//
// Why keyed by agentId::requestedCapability instead of approval id: the
// in-memory approval ids are regenerated on every module init (page
// reload), so an id-keyed record could never match again. The
// (agentId, requestedCapability) pair is the stable identity of a seeded
// approval request. Latest decision per key wins.
// ─────────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const DECISIONS_FILE = path.join(DATA_DIR, "approval-decisions.jsonl");
const MAX_READ = 1000;

export interface ApprovalDecisionRecord {
  /** Stable identity: `${agentId}::${requestedCapability}` */
  key: string;
  agentId: string;
  requestedCapability: string;
  decision: "approved" | "rejected";
  reason: string;
  at: string;
}

export async function appendApprovalDecision(
  rec: ApprovalDecisionRecord
): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(DECISIONS_FILE, `${JSON.stringify(rec)}\n`, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "append failed" };
  }
}

/** Returns the latest decision per stable key. */
export async function readApprovalDecisions(): Promise<Record<string, ApprovalDecisionRecord>> {
  let raw: string;
  try {
    raw = await fs.readFile(DECISIONS_FILE, "utf8");
  } catch {
    return {};
  }
  const byKey: Record<string, ApprovalDecisionRecord> = {};
  const lines = raw.split("\n").slice(-MAX_READ);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as ApprovalDecisionRecord;
      if (rec && typeof rec.key === "string" && (rec.decision === "approved" || rec.decision === "rejected")) {
        byKey[rec.key] = rec; // later lines overwrite → latest wins
      }
    } catch {
      // skip malformed line rather than fail the read
    }
  }
  return byKey;
}
