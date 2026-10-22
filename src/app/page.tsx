"use client";

import { TerminalWorkspace } from "@/components/control-room/TerminalWorkspace";

export default function MissionControlHome() {
  return (
    <main className="mc-home p-3 sm:p-4 space-y-4">
      <header className="mc-home-intro py-0.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Mission Control</h1>
        <p className="text-[13px] leading-5 text-muted mt-1">
          Four free operator panes over the independent agent/session pool. Select a pane, then bind an agent or existing session from the pane controls or sidebar.
        </p>
      </header>
      <TerminalWorkspace />
    </main>
  );
}