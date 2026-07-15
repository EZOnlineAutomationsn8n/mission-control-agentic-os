"use client";

import { TerminalWorkspace } from "@/components/control-room/TerminalWorkspace";

export default function MissionControlHome() {
  return (
    <main className="p-4 space-y-3">
      <header>
        <h1 className="text-lg font-semibold">Mission Control</h1>
        <p className="text-xs text-muted mt-1">
          Four interchangeable operator terminals. Select a terminal, then choose an agent here or from the sidebar.
        </p>
      </header>
      <TerminalWorkspace />
    </main>
  );
}