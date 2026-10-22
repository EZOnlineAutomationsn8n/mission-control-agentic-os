"use client";

import { useEffect, useState } from "react";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { LogEntry, LogLevel, ReportRef } from "@/lib/connectors/types";
import { timeAgo } from "@/lib/ui-helpers";
import { getRecentActions, subscribe, type ActionLogEntry } from "@/lib/action-log-store";
import type { PersistedAuditEvent } from "@/lib/audit-log-store";
import { FocusablePanel } from "@/components/shell/PanelFocus";

export function EvidenceView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [reports, setReports] = useState<(ReportRef & { agentName: string })[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [actions, setActions] = useState<ActionLogEntry[]>([]);
  const [persistedAudit, setPersistedAudit] = useState<PersistedAuditEvent[]>([]);

  async function refresh() {
    const states = await Promise.all(connectorRegistry.list().map((a) => a.getState()));
    setLogs(states.flatMap((s) => s.logs).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)));
    setReports(
      states.flatMap((s) =>
        s.reports.map((r) => ({ ...r, agentName: connectorRegistry.get(s.id)?.descriptor().name ?? s.id }))
      )
    );
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live mock adapter poll
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial read of the audit action log
    setActions(getRecentActions(undefined, 50));
    return subscribe(() => setActions(getRecentActions(undefined, 50)));
  }, []);

  async function refreshPersistedAudit() {
    try {
      const res = await fetch("/api/audit", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { events: PersistedAuditEvent[] };
      setPersistedAudit(data.events);
    } catch {
      // best-effort read; live in-memory audit trail above still shows current-session events
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch of the on-disk audit log
    refreshPersistedAudit();
    const t = setInterval(refreshPersistedAudit, 8000);
    return () => clearInterval(t);
  }, []);

  const errors = logs.filter((l) => l.level === "error" || l.level === "warn");
  const errorsByAgent = new Map<string, number>();
  for (const e of errors) errorsByAgent.set(e.agentId, (errorsByAgent.get(e.agentId) ?? 0) + 1);

  const filteredLogs = logs.filter((l) => {
    if (agentFilter !== "all" && l.agentId !== agentFilter) return false;
    if (levelFilter !== "all" && l.level !== levelFilter) return false;
    return true;
  });

  async function saveToBrain(r: ReportRef) {
    await connectorRegistry.get(r.agentId)?.saveReportToBrain(r.id);
    refresh();
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Evidence / Logs</h1>
        <p className="text-sm text-muted mt-1">Structured log viewer, proof panel, and reports across the fleet.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-xs text-muted mb-1">Total log entries</div>
          <div className="text-xl font-semibold mono">{logs.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-xs text-muted mb-1">Warnings / errors</div>
          <div className="text-xl font-semibold mono text-warn">{errors.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-xs text-muted mb-1">Reports available</div>
          <div className="text-xl font-semibold mono">{reports.length}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="text-sm font-medium mb-2">Errors grouped by agent</div>
        <div className="flex flex-wrap gap-2 text-xs">
          {Array.from(errorsByAgent.entries()).map(([id, count]) => (
            <span key={id} className="rounded bg-warn/10 text-warn px-2 py-1">
              {connectorRegistry.get(id)?.descriptor().name ?? id}: {count}
            </span>
          ))}
          {errorsByAgent.size === 0 && <span className="text-muted">No warnings or errors logged.</span>}
        </div>
      </div>

      <FocusablePanel id="evidence-live-audit" label="Evidence · Live session audit events">
      <div className="rounded-lg border border-border bg-panel p-4 h-full">
        <div className="text-sm font-medium mb-1">Live session audit events</div>
        <p className="text-xs text-muted mb-3">
          Every approval, rejection, and controlled action across the fleet — independent of connector
          health/status. Recorded only after the underlying action actually completed (approved/rejected/
          brain-write-failed/completed/failed), never a fabricated success. In-memory for this tab session.
        </p>
        <div className="mono text-xs space-y-1 max-h-64 overflow-y-auto">
          {actions.map((a, i) => (
            <div key={`${a.timestamp}-${i}`} className="mc-log-row flex gap-2">
              <span className="text-muted shrink-0">{new Date(a.timestamp).toLocaleTimeString()}</span>
              <span className="text-muted shrink-0 w-24 truncate">
                {connectorRegistry.get(a.connectorId)?.descriptor().name ?? a.connectorId}
              </span>
              <span
                className={
                  a.status === "failed" || a.status === "rejected" || a.status === "brain-write-failed"
                    ? "text-danger"
                    : a.status === "approved" || a.status === "completed"
                      ? "text-ok"
                      : "text-foreground/80"
                }
              >
                [{a.actionType}] {a.status} — {a.resultSummary}
              </span>
            </div>
          ))}
          {actions.length === 0 && <div className="text-muted">No audit events recorded yet.</div>}
        </div>
      </div>
      </FocusablePanel>

      <FocusablePanel id="evidence-persisted-audit" label="Evidence · Persisted audit log">
      <div className="rounded-lg border border-border bg-panel p-4 h-full">
        <div className="text-sm font-medium mb-1">Persisted audit log</div>
        <p className="text-xs text-muted mb-3">
          Same event stream, read back from <code className="mono">data/audit-log.jsonl</code> on disk
          (project-local, append-only) — survives a full page reload, not just in-tab navigation.
        </p>
        <div className="mono text-xs space-y-1 max-h-64 overflow-y-auto">
          {persistedAudit.map((a, i) => (
            <div key={`${a.timestamp}-${i}`} className="mc-log-row flex gap-2">
              <span className="text-muted shrink-0">{new Date(a.timestamp).toLocaleTimeString()}</span>
              <span className="text-muted shrink-0 w-24 truncate">
                {connectorRegistry.get(a.connectorId)?.descriptor().name ?? a.connectorId}
              </span>
              <span
                className={
                  a.status === "failed" || a.status === "rejected" || a.status === "brain-write-failed"
                    ? "text-danger"
                    : a.status === "approved" || a.status === "completed"
                      ? "text-ok"
                      : "text-foreground/80"
                }
              >
                [{a.actionType}] {a.status} — {a.resultSummary}
              </span>
            </div>
          ))}
          {persistedAudit.length === 0 && <div className="text-muted">No persisted audit events yet.</div>}
        </div>
      </div>
      </FocusablePanel>

      <FocusablePanel id="evidence-structured-logs" label="Evidence · Structured logs">
      <div className="rounded-lg border border-border bg-panel p-4 h-full">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="text-sm font-medium">Structured logs</div>
          <div className="flex flex-wrap gap-2 text-xs min-w-0">
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="bg-panel-2 rounded px-2 py-1">
              <option value="all">All agents</option>
              {connectorRegistry.list().map((a) => (
                <option key={a.descriptor().id} value={a.descriptor().id}>
                  {a.descriptor().name}
                </option>
              ))}
            </select>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as LogLevel | "all")}
              className="bg-panel-2 rounded px-2 py-1"
            >
              <option value="all">All levels</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>
        </div>
        <div className="mono text-xs space-y-1 max-h-96 overflow-y-auto">
          {filteredLogs.map((l) => (
            <div key={l.id} className="mc-log-row flex gap-2">
              <span className="text-muted shrink-0">{new Date(l.timestamp).toLocaleTimeString()}</span>
              <span className="text-muted shrink-0 w-24 truncate">{connectorRegistry.get(l.agentId)?.descriptor().name ?? l.agentId}</span>
              <span
                className={
                  l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warn" : "text-foreground/80"
                }
              >
                [{l.level}] {l.message}
              </span>
            </div>
          ))}
        </div>
      </div>
      </FocusablePanel>

      <FocusablePanel id="evidence-reports" label="Evidence · Reports and proofs">
      <div className="rounded-lg border border-border bg-panel p-4 h-full">
        <div className="text-sm font-medium mb-3">Latest reports / proofs</div>
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="rounded border border-border bg-panel-2 p-2 text-xs flex items-center justify-between">
              <div>
                <div className="font-medium">{r.title}</div>
                <div className="text-muted">
                  {r.agentName} · {r.kind} · {timeAgo(r.createdAt)}
                </div>
              </div>
              {r.savedToBrain ? (
                <span className="text-ok">saved → {r.brainPath}</span>
              ) : (
                <button onClick={() => saveToBrain(r)} className="rounded bg-accent/20 text-accent px-2 py-1 hover:bg-accent/30">
                  Save to Obsidian
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      </FocusablePanel>
    </div>
  );
}
