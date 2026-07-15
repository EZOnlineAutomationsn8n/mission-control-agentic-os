"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PersistedAuditEvent } from "@/lib/audit-log-store";
import type { OperatorWorkItem, WorkStage } from "@/lib/operator-work";

const STAGES: WorkStage[] = ["capture", "human-gate", "execute", "shipped"];

export function QueueBoard() {
  const [items, setItems] = useState<OperatorWorkItem[]>([]);
  const [events, setEvents] = useState<PersistedAuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [workResponse, auditResponse] = await Promise.all([
      fetch("/api/work-items", { cache: "no-store" }),
      fetch("/api/audit", { cache: "no-store" }),
    ]);
    const workBody = await workResponse.json() as { items?: OperatorWorkItem[]; error?: string };
    const auditBody = await auditResponse.json() as { events?: PersistedAuditEvent[]; error?: string };
    if (!workResponse.ok) throw new Error(workBody.error || "Queue read failed");
    if (!auditResponse.ok) throw new Error(auditBody.error || "Audit read failed");
    setItems(workBody.items ?? []);
    setEvents((auditBody.events ?? []).slice(0, 20));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial read from persistent work and audit APIs
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Queue read failed"));
    const timer = setInterval(() => refresh().catch(() => undefined), 8_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Work Queue</h1>
          <p className="text-sm text-muted mt-1">Live projection of PostgreSQL work items and the append-only audit ledger.</p>
        </div>
        <Link href="/pipeline" className="rounded bg-accent/20 px-3 py-2 text-xs text-accent hover:bg-accent/30">Open pipeline</Link>
      </div>
      {error && <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded-lg border border-border bg-panel p-3 min-h-[190px] space-y-2">
            <div className="flex justify-between text-xs uppercase tracking-wide"><span>{stage.replace("-", " ")}</span><span className="mono text-muted">{items.filter((item) => item.stage === stage).length}</span></div>
            {items.filter((item) => item.stage === stage).map((item) => (
              <div key={item.id} className="rounded border border-border bg-panel-2 p-2 text-xs space-y-1">
                <div className="font-medium">{item.title}</div>
                {item.description && <div className="text-muted line-clamp-2">{item.description}</div>}
                <div className="text-[10px] mono text-muted">{item.assignedAgentId || "unassigned"}</div>
              </div>
            ))}
            {items.every((item) => item.stage !== stage) && <div className="py-4 text-center text-[11px] text-muted">no items</div>}
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-panel p-4">
        <h2 className="text-sm font-medium mb-3">Recent evidence</h2>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {events.map((event, index) => (
            <div key={`${event.timestamp}-${index}`} className="grid grid-cols-[150px_150px_1fr] gap-3 border-b border-border/60 py-2 text-xs">
              <span className="mono text-muted">{new Date(event.timestamp).toLocaleString()}</span>
              <span className="text-accent">{event.connectorId}</span>
              <span>{event.actionType} — {event.status}: {event.resultSummary}</span>
            </div>
          ))}
          {events.length === 0 && <div className="text-sm text-muted">No audit events recorded.</div>}
        </div>
      </div>
    </div>
  );
}
