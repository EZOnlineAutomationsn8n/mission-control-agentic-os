import type { WorkItem, WorkItemState } from "@/lib/connectors/types";
import { connectorRegistry } from "@/lib/connectors/registry";
import { getRecentActions } from "@/lib/action-log-store";

// Work Queue is now DERIVED, not seeded. It reflects two real,
// already-governed data sources — never fake demo rows:
//   1. Every connector's real `pendingApprovals` (from getState()) — each
//      becomes a "blocked" work item awaiting an operator decision.
//   2. The real controlled-action / approval audit log
//      (src/lib/action-log-store.ts) — each recorded event becomes a work
//      item reflecting what actually ran and how it actually concluded.
// There is no local mutable item list and no assign/route mutation here:
// an item's state is a read-through projection of the approval or audit
// event it was built from, so it can never drift into a fabricated state.

function actionStatusToWorkState(status: string): WorkItemState {
  switch (status) {
    case "running":
      return "running";
    case "approved":
    case "completed":
      return "completed";
    case "blocked":
    case "waiting-approval":
    case "action_required":
      return "blocked";
    case "rejected":
    case "failed":
    case "brain-write-failed":
    case "upstream_provider_failed":
    case "timeout":
      return "failed";
    default:
      return "queued";
  }
}

export const queueStore = {
  async list(): Promise<WorkItem[]> {
    const approvalItems: WorkItem[] = [];
    for (const adapter of connectorRegistry.list()) {
      const state = await adapter.getState();
      for (const ap of state.pendingApprovals) {
        approvalItems.push({
          id: `approval-${ap.id}`,
          title: `Approval requested: ${ap.requestedCapability}`,
          description: ap.context,
          state: "blocked",
          assignedAgentId: ap.agentId,
          createdAt: ap.requestedAt,
          updatedAt: ap.requestedAt,
          history: ap.auditTrail.map((e) => ({
            at: e.at,
            event: `${e.actor} ${e.action}${e.reason ? `: ${e.reason}` : ""}`,
          })),
        });
      }
    }

    const actionItems: WorkItem[] = getRecentActions(undefined, 40).map((a, i) => ({
      id: `action-${a.timestamp}-${i}`,
      title: a.actionType,
      description: a.resultSummary,
      state: actionStatusToWorkState(a.status),
      assignedAgentId: a.connectorId,
      createdAt: a.timestamp,
      updatedAt: a.timestamp,
      history: [{ at: a.timestamp, event: `${a.status} — ${a.resultSummary}` }],
    }));

    return [...approvalItems, ...actionItems].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },
};
