"use client";

import Link from "next/link";
import { AgentWindow } from "@/components/control-room/AgentWindow";

// Paperclip workspace — build/assets/work products. The live service is
// reachable (health + open link via the connector pane below); its
// project/build data is NOT wired into this app yet, and the empty state
// says exactly what is missing instead of showing invented cards.

export default function PaperclipPage() {
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-semibold">Paperclip</h1>
        <p className="text-sm text-muted mt-1">Build, assets, and work products from the Paperclip runtime.</p>
      </div>

      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="text-sm font-medium mb-1">Projects / builds</div>
        <div className="rounded border border-warn/40 bg-warn/10 p-3 text-xs space-y-1">
          <div className="uppercase tracking-wide font-semibold text-warn">Action required</div>
          <div className="text-foreground/90">
            No project/build data source is wired. Next wiring requirement: an authenticated, read-only Paperclip
            projects endpoint (list projects/builds, no document content) exposed via{" "}
            <span className="mono">/api/connectors/paperclip/projects</span>. Until then, use the real Paperclip UI
            via &ldquo;Open real console&rdquo; in the pane below.
          </div>
        </div>
      </div>

      <div className="max-w-xl">
        <AgentWindow systemId="paperclip" />
        <div className="mt-2 text-xs">
          <Link href="/systems/paperclip" className="text-accent hover:underline">
            Open full control room →
          </Link>
        </div>
      </div>
    </div>
  );
}
