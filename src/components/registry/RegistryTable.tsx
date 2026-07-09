"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { connectorRegistry } from "@/lib/connectors/registry";
import { CATEGORY_ORDER, connectorCounts, getConnectorDirectory } from "@/lib/connectors/directory";
import { statusColor, dotGlowStyle } from "@/lib/ui-helpers";
import type { AgentSystemState, ConnectorCategory } from "@/lib/connectors/types";
import { getLastAction } from "@/lib/action-log-store";

function capabilityModeLabel(live: AgentSystemState | undefined): string {
  if (!live) return "NOT WIRED";
  if (live.outputKind === "mock-stream") return "NOT WIRED";
  if (live.controlledAction) return "READY TO USE";
  const real = live.capabilities.filter((c) => c.kind !== "status" && c.kind !== "blocked");
  const available = real.find((c) => c.available);
  if (available) return `READ AVAILABLE (${available.kind})`;
  if (live.capabilities.some((c) => c.kind === "blocked" || !c.available)) return "ACTION REQUIRED";
  return "NEEDS INTEGRATION";
}

export function RegistryTable() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ConnectorCategory | "all">("all");
  // Live per-adapter state, polled the same way Operator Home/Sidebar do —
  // lets the Status column reflect a real connector's connected/degraded/
  // disconnected reading instead of the static descriptor snapshot.
  const [liveStates, setLiveStates] = useState<Record<string, AgentSystemState>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(
        connectorRegistry.list().map(async (a) => [a.descriptor().id, await a.getState()] as const)
      );
      if (!cancelled) setLiveStates(Object.fromEntries(entries));
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const directory = useMemo(() => getConnectorDirectory(), []);
  const counts = useMemo(() => connectorCounts(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return directory.filter((s) => {
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.capabilities.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [directory, query, categoryFilter]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">System Registry</h1>
        <p className="text-sm text-muted mt-1">
          Every connector attached to the Agentic OS — active and future. Real connection fields are disabled in v1
          — this is where a new integration attaches.{" "}
          <span className="mono text-foreground/80">
            {counts.active} active · {counts.pending} pending · {counts.total} total
          </span>
        </p>
      </div>

      <div className="flex gap-2 items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connectors, category, capability…"
          className="flex-1 bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as ConnectorCategory | "all")}
          className="bg-panel-2 rounded px-2 py-2 text-sm"
        >
          <option value="all">All categories</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-border bg-panel overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-panel-2 text-xs text-muted uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">System</th>
              <th className="text-left px-4 py-2">Category</th>
              <th className="text-left px-4 py-2">Type</th>
              <th className="text-left px-4 py-2">Health</th>
              <th className="text-left px-4 py-2">Capability mode</th>
              <th className="text-left px-4 py-2">Last action</th>
              <th className="text-left px-4 py-2">Mode</th>
              <th className="text-left px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const open = expanded === s.id;
              const fullDescriptor = s.isActive ? connectorRegistry.get(s.id)?.descriptor() : null;
              const live = liveStates[s.id];
              const displayStatus = s.isActive ? live?.status ?? s.status : s.status;
              return (
                <React.Fragment key={s.id}>
                  <tr className="border-t border-border">
                    <td className="px-4 py-2">
                      {s.isActive ? (
                        <Link href={`/systems/${s.id}`} className="hover:text-accent font-medium">
                          {s.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-muted">{s.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted text-xs">{s.category}</td>
                    <td className="px-4 py-2 text-muted">{s.type}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="status-dot" style={dotGlowStyle(statusColor(displayStatus))} />
                        {displayStatus}
                        {live && live.commandExecution === false && !live.controlledAction && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono text-warn bg-warn/10">
                            not commandable
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 mono text-xs">{capabilityModeLabel(live)}</td>
                    <td className="px-4 py-2 mono text-xs">
                      {(() => {
                        const last = getLastAction(s.id);
                        if (!last) return <span className="text-muted">—</span>;
                        return (
                          <span className={last.status === "completed" ? "text-ok" : "text-warn"}>{last.status}</span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2 mono text-xs">
                      {fullDescriptor ? fullDescriptor.activeMode : s.connectionModes.join(", ")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setExpanded(open ? null : s.id)}
                        className="text-xs text-accent hover:underline"
                      >
                        {open ? "hide" : "details"}
                      </button>
                    </td>
                  </tr>
                  {open && fullDescriptor && (
                    <tr className="border-t border-border bg-panel-2/40">
                      <td colSpan={8} className="px-4 py-4">
                        {live && live.capabilities.length > 0 && (
                          <div className="mb-4">
                            <div className="text-xs text-muted mb-1">Live capabilities / blocked reasons</div>
                            <div className="flex flex-wrap gap-1.5">
                              {live.capabilities.map((c, i) => (
                                <span
                                  key={`${c.kind}-${i}`}
                                  className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ${
                                    c.kind === "blocked" || !c.available ? "text-warn bg-warn/10" : "text-ok bg-ok/10"
                                  }`}
                                >
                                  {c.kind === "blocked" ? `blocked: ${c.reason ?? "no reason given"}` : `${c.kind}${c.available ? "" : ` (blocked: ${c.reason ?? "no reason"})`}`}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {live?.outputKind === "live-status" && live.statusDetail && (
                          <div className="mb-4">
                            <div className="text-xs text-muted mb-1">Live status (read-only)</div>
                            <div className="rounded border border-border bg-panel p-2.5 mono text-xs space-y-1 max-w-xl">
                              {Object.entries(live.statusDetail).map(([key, value]) => (
                                <div key={key} className="flex gap-2">
                                  <span className="text-muted shrink-0">{key}:</span>
                                  <span className="text-foreground/90 break-words">{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <div className="text-xs text-muted mb-1">Capabilities</div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {fullDescriptor.capabilities.map((c) => (
                                <span key={c} className="text-xs rounded bg-panel px-2 py-1">
                                  {c}
                                </span>
                              ))}
                            </div>
                            <div className="text-xs text-muted mb-1">Permissions</div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {fullDescriptor.permissions.map((p) => (
                                <span key={p} className="text-xs rounded bg-panel px-2 py-1 mono">
                                  {p}
                                </span>
                              ))}
                            </div>
                            <div className="text-xs text-muted mb-1">Connection modes supported</div>
                            <div className="flex flex-wrap gap-1.5">
                              {fullDescriptor.connectionModes.map((m) => (
                                <span
                                  key={m}
                                  className={`text-xs rounded px-2 py-1 mono ${
                                    m === fullDescriptor.activeMode ? "bg-accent/20 text-accent" : "bg-panel"
                                  }`}
                                >
                                  {m}
                                </span>
                              ))}
                            </div>
                            <div className="text-xs text-muted mt-3">
                              Memory write obligation:{" "}
                              <span className={fullDescriptor.memoryWriteObligation ? "text-ok" : "text-muted"}>
                                {fullDescriptor.memoryWriteObligation ? "yes" : "n/a (this is the Brain)"}
                              </span>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-muted mb-2">
                              Real connector attachment point (disabled in v1)
                            </div>
                            <div className="space-y-2">
                              {fullDescriptor.realConnectionFields.map((f) => (
                                <div key={f.key}>
                                  <label className="text-[11px] text-muted block mb-0.5">{f.label}</label>
                                  <input
                                    disabled
                                    placeholder={f.placeholder}
                                    type={f.kind === "secret" ? "password" : "text"}
                                    className="w-full bg-panel border border-border rounded px-2 py-1.5 text-xs mono opacity-50 cursor-not-allowed"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {open && !fullDescriptor && (
                    <tr className="border-t border-border bg-panel-2/40">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="text-xs rounded border border-warn/30 bg-warn/10 text-warn px-2 py-1.5 mb-3 inline-block">
                          pending-setup — no adapter implemented. Not openable, not a control room, not a live agent.
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <div className="text-xs text-muted mb-1">Planned capabilities</div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {s.capabilities.map((c) => (
                                <span key={c} className="text-xs rounded bg-panel px-2 py-1">
                                  {c}
                                </span>
                              ))}
                            </div>
                            <div className="text-xs text-muted mb-1">Planned connection modes</div>
                            <div className="flex flex-wrap gap-1.5">
                              {s.connectionModes.map((m) => (
                                <span key={m} className="text-xs rounded px-2 py-1 mono bg-panel">
                                  {m}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted mb-1">Notes</div>
                            <div className="text-xs text-foreground/80 mb-3">{s.notes ?? "—"}</div>
                            <div className="text-[11px] text-muted">
                              To activate: add one adapter file implementing{" "}
                              <span className="mono">AgentSystemAdapter</span>, register it in{" "}
                              <span className="mono">registry.ts</span>, optionally add seed mock data. Zero UI
                              redesign required.
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
