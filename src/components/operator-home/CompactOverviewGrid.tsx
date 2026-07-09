"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { AgentSystemState } from "@/lib/connectors/types";
import { runStateColor, statusColor, timeAgo, dotGlowStyle } from "@/lib/ui-helpers";

// Compact status cards for active systems only — small, glanceable, NOT
// full terminals. Used for the "All active (compact)" focus set and for
// the slim "other active systems" strip beneath the 2x2 cockpit windows.
// Renders purely from adapter state; no per-agent branching.

export function CompactOverviewGrid({ systemIds }: { systemIds?: string[] }) {
  const [states, setStates] = useState<AgentSystemState[]>([]);

  async function refresh() {
    const adapters = systemIds
      ? systemIds.map((id) => connectorRegistry.get(id)).filter((a): a is NonNullable<typeof a> => !!a)
      : connectorRegistry.list();
    setStates(await Promise.all(adapters.map((a) => a.getState())));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live mock adapter poll
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemIds?.join(",")]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {states.map((s) => {
        const d = connectorRegistry.get(s.id)?.descriptor();
        return (
          <motion.div
            key={s.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-border bg-panel p-3 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="status-dot shrink-0" style={dotGlowStyle(statusColor(s.status))} />
                <span className="font-medium text-sm truncate">{s.name}</span>
              </div>
              <span className="flex items-center gap-1 shrink-0">
                {s.outputKind === "mock-stream" && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono text-muted bg-panel-2">
                    not wired
                  </span>
                )}
                <span
                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono"
                  style={{ color: runStateColor(s.runState), backgroundColor: `${runStateColor(s.runState)}22` }}
                >
                  {s.runState}
                </span>
              </span>
            </div>
            <div className="text-xs text-muted truncate">{s.currentTask ?? "— idle —"}</div>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>synced {timeAgo(d?.lastSync ?? null)}</span>
              {s.pendingApprovals.length > 0 && <span className="text-warn">{s.pendingApprovals.length} approval(s)</span>}
            </div>
            <Link
              href={`/systems/${s.id}`}
              className="text-center text-xs rounded bg-panel-2 hover:bg-border transition-colors px-2 py-1.5"
            >
              Open control room
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
