"use client";

import { useEffect, useState } from "react";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { ApprovalRequest, RiskLevel } from "@/lib/connectors/types";
import type { PersistedApprovalDecision } from "@/lib/approval-decision-store";
import { riskColor, timeAgo } from "@/lib/ui-helpers";
import { FocusablePanel } from "@/components/shell/PanelFocus";

interface Row extends Omit<ApprovalRequest, "riskLevel"> {
  agentName: string;
  riskLevel: RiskLevel | null;
}

export function ApprovalsCenter() {
  const [rows, setRows] = useState<Row[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  async function refresh() {
    const [all, decisionResponse] = await Promise.all([
      Promise.all(connectorRegistry.list().map(async (a) => {
        const state = await a.getState();
        return state.pendingApprovals.map((ap) => ({ ...ap, agentName: a.descriptor().name }));
      })),
      fetch("/api/approvals", { cache: "no-store" }),
    ]);
    if (!decisionResponse.ok) throw new Error(`approval history fetch failed (${decisionResponse.status})`);
    const { decisions } = (await decisionResponse.json()) as { decisions: PersistedApprovalDecision[] };
    const pending = all.flat();
    const decided: Row[] = decisions.map((decision) => ({
      id: decision.approvalId,
      agentId: decision.connectorId,
      agentName: connectorRegistry.get(decision.connectorId)?.descriptor().name ?? decision.connectorId,
      requestedCapability: decision.requestedCapability,
      context: decision.context ?? "Migrated decision from the previous approval store; original request context was not persisted.",
      riskLevel: decision.riskLevel,
      requestedAt: decision.requestedAt ?? decision.decidedAt,
      status: decision.status,
      auditTrail: [
        ...(decision.requestedAt
          ? [{ at: decision.requestedAt, actor: "system", action: "requested" }]
          : []),
        { at: decision.decidedAt, actor: decision.actor, action: decision.status, reason: decision.reason },
      ],
    }));
    const decidedKeys = new Set(decided.map((row) => `${row.agentId}::${row.requestedCapability}`));
    setRows([
      ...decided,
      ...pending.filter((row) => !decidedKeys.has(`${row.agentId}::${row.requestedCapability}`)),
    ]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live mock adapter poll
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  async function approve(row: Row) {
    await connectorRegistry.get(row.agentId)?.approve(row.id, "approved from Approvals Center");
    await refresh();
  }
  async function reject(row: Row) {
    const rejectionReason = reason.trim();
    if (!rejectionReason) return;
    await connectorRegistry.get(row.agentId)?.reject(row.id, rejectionReason);
    await refresh();
    setRejecting(null);
    setReason("");
  }

  const visible = filter === "pending" ? rows.filter((r) => r.status === "pending") : rows;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Approvals Center</h1>
          <p className="text-sm text-muted mt-1">
            Cross-system approval queue. Decisions write to the Brain&apos;s governance log automatically.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setFilter("pending")}
            className={`whitespace-nowrap rounded px-2 py-1 ${filter === "pending" ? "bg-accent/20 text-accent" : "bg-panel-2"}`}
          >
            Pending ({rows.filter((r) => r.status === "pending").length})
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`whitespace-nowrap rounded px-2 py-1 ${filter === "all" ? "bg-accent/20 text-accent" : "bg-panel-2"}`}
          >
            All
          </button>
        </div>
      </div>

      <FocusablePanel id="approvals-queue" label="Approvals Center · Approval queue">
      <div className="space-y-2">
        {visible.length === 0 && (
          <div className="text-sm text-muted rounded-lg border border-border bg-panel p-6 text-center">
            No approvals to show.
          </div>
        )}
        {visible.map((row) => (
          <div key={row.id} className="rounded-lg border border-border bg-panel p-4 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{row.agentName}</span>
                <span className="text-muted">·</span>
                <span>{row.requestedCapability}</span>
              </div>
              {row.riskLevel ? (
                <span
                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono"
                  style={{ color: riskColor(row.riskLevel), backgroundColor: `${riskColor(row.riskLevel)}22` }}
                >
                  {row.riskLevel}
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono text-muted bg-panel-2">
                  legacy risk unknown
                </span>
              )}
            </div>
            <div className="text-muted text-xs">{row.context}</div>
            <div className="text-[11px] text-muted">requested {timeAgo(row.requestedAt)}</div>

            {row.status === "pending" ? (
              <div className="flex gap-2 items-center pt-1">
                <button
                  onClick={() => approve(row)}
                  className="text-xs rounded bg-ok/20 text-ok px-3 py-1.5 hover:bg-ok/30"
                >
                  Approve
                </button>
                {rejecting === row.id ? (
                  <form
                    className="flex gap-1 flex-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      reject(row);
                    }}
                  >
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="reason for rejection…"
                      required
                      className="flex-1 bg-panel-2 rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-danger"
                    />
                    <button
                      type="submit"
                      disabled={!reason.trim()}
                      className="text-xs rounded bg-danger/20 text-danger px-3 py-1.5 hover:bg-danger/30 disabled:opacity-40"
                    >
                      Confirm reject
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setRejecting(row.id)}
                    className="text-xs rounded bg-danger/20 text-danger px-3 py-1.5 hover:bg-danger/30"
                  >
                    Reject
                  </button>
                )}
              </div>
            ) : (
              <div className={`text-xs font-medium ${row.status === "approved" ? "text-ok" : "text-danger"}`}>
                {row.status}
              </div>
            )}

            <div className="text-[10px] text-muted border-t border-border pt-2 mt-1 space-y-0.5">
              {row.auditTrail.map((ev, i) => (
                <div key={i}>
                  {timeAgo(ev.at)} — {ev.actor} {ev.action}
                  {ev.reason ? `: ${ev.reason}` : ""}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      </FocusablePanel>
    </div>
  );
}
