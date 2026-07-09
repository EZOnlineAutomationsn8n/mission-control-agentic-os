"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { queueStore } from "@/lib/queue-store";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { WorkItem, WorkItemState } from "@/lib/connectors/types";
import { workStateColor, timeAgo, dotGlowStyle } from "@/lib/ui-helpers";

const LANES: WorkItemState[] = ["queued", "running", "blocked", "completed", "failed"];

export function QueueBoard() {
  const [items, setItems] = useState<WorkItem[]>([]);

  async function refresh() {
    setItems(await queueStore.list());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount, then poll for real approvals/actions
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  function agentName(id: string | null) {
    if (!id) return "unassigned";
    return connectorRegistry.get(id)?.descriptor().name ?? id;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Work Queue</h1>
        <p className="text-sm text-muted mt-1">
          Derived directly from real pending approvals and the controlled-action / approval audit log — not
          seeded demo rows. An item&apos;s lane is a read-through projection of that approval or audit event;
          decide it from Approvals Center or a system&apos;s control room, not from here.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
        {LANES.map((lane) => (
          <div key={lane} className="rounded-lg border border-border bg-panel p-3 flex flex-col gap-2 min-h-[200px]">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <span className="status-dot" style={dotGlowStyle(workStateColor(lane))} />
              <span>{lane}</span>
              <span className="text-muted ml-auto mono">
                {items.filter((i) => i.state === lane).length}
              </span>
            </div>

            {items
              .filter((i) => i.state === lane)
              .map((item) => (
                <motion.div
                  layout
                  key={item.id}
                  className="rounded border border-border bg-panel-2 p-2 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium mono">{item.id}</span>
                  </div>
                  <div>{item.title}</div>
                  <div className="text-muted line-clamp-2">{item.description}</div>
                  <div className="flex items-center justify-between text-[10px] text-muted">
                    <span>→ {agentName(item.assignedAgentId)}</span>
                    <span>{timeAgo(item.updatedAt)}</span>
                  </div>

                  {item.assignedAgentId && (
                    <Link
                      href={`/systems/${item.assignedAgentId}`}
                      className="block w-full text-center rounded bg-panel hover:bg-border transition-colors px-2 py-1"
                    >
                      {item.state === "blocked" ? "Decide in control room / Approvals" : "Open control room"}
                    </Link>
                  )}

                  <div className="text-[10px] text-muted border-t border-border pt-1 mt-1 space-y-0.5 max-h-16 overflow-y-auto">
                    {item.history.slice(-3).map((h, i) => (
                      <div key={i}>{h.event}</div>
                    ))}
                  </div>
                </motion.div>
              ))}

            {items.filter((i) => i.state === lane).length === 0 && (
              <div className="text-muted text-[11px] text-center py-4">no items</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
