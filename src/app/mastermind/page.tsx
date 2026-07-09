"use client";

import { useState } from "react";
import Link from "next/link";
import { AGENT_PAGES } from "@/lib/agent-pages";

// AI Agent Mastermind — shared room concept: one input, visible agent
// chips, @tagging. Multi-agent dispatch is NOT wired yet, and this page
// does not fake it: submitting shows exactly which route is missing per
// tagged agent. The component boundaries (composer → dispatch → per-agent
// responses) are kept clean so a real POST /api/mastermind/dispatch can
// attach later without a rewrite.

const ROOM_AGENT_IDS = ["claude", "hermes", "gemini", "codex", "openclaw", "free-claude-code"] as const;

interface RoomEntry {
  at: string;
  kind: "user" | "system";
  text: string;
  tags: string[];
}

function parseTags(text: string): string[] {
  const tags = new Set<string>();
  const re = /@([a-z0-9-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tags.add(m[1].toLowerCase());
  return Array.from(tags);
}

export default function MastermindPage() {
  const agents = ROOM_AGENT_IDS.map((id) => AGENT_PAGES.find((a) => a.id === id)!).filter(Boolean);
  const [input, setInput] = useState("");
  const [log, setLog] = useState<RoomEntry[]>([]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    const tags = parseTags(text);
    const tagged = tags.length > 0 ? agents.filter((a) => tags.includes(a.id) || tags.includes(a.id.replace(/-/g, ""))) : agents;

    const missingLines = tagged.map((a) =>
      a.missing
        ? `@${a.id}: ${a.missing}`
        : `@${a.id}: route exists (POST /api/connectors/fcc/actions/ask) but Mastermind dispatch is not wired to it yet — use its own page for now.`
    );

    setLog((prev) => [
      ...prev,
      { at: new Date().toISOString(), kind: "user", text, tags },
      {
        at: new Date().toISOString(),
        kind: "system",
        text:
          "ACTION REQUIRED — multi-agent dispatch is not wired. Missing route: POST /api/mastermind/dispatch (fan-out to per-agent endpoints). Per-agent state:\n" +
          missingLines.join("\n"),
        tags: [],
      },
    ]);
    setInput("");
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold">AI Agent Mastermind</h1>
        <p className="text-sm text-muted mt-1">
          Shared room for the agent team. Tag agents with @claude, @hermes, @codex… One input, one room.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {agents.map((a) => (
          <Link
            key={a.id}
            href={`/agents/${a.id}`}
            className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 transition-colors ${
              a.missing ? "bg-panel-2 text-muted hover:text-foreground" : "bg-ok/15 text-ok hover:bg-ok/25"
            }`}
          >
            <span className="status-dot" style={{ backgroundColor: a.missing ? "var(--warn)" : "var(--ok)" }} />
            @{a.id}
            {!a.missing && <span className="text-[10px] uppercase">ready</span>}
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs space-y-1">
        <div className="uppercase tracking-wide font-semibold text-warn">Action required</div>
        <div className="text-foreground/90">
          Multi-agent dispatch route not wired — needs <span className="mono">POST /api/mastermind/dispatch</span>{" "}
          fanning out to per-agent endpoints. Only Free Claude Code has a working endpoint today (usable on{" "}
          <Link href="/agents/free-claude-code" className="text-accent hover:underline">
            its own page
          </Link>
          ).
        </div>
      </div>

      <div className="rounded-lg border border-border bg-panel p-3 min-h-48 max-h-[50vh] overflow-y-auto space-y-2 text-sm">
        {log.length === 0 && <div className="text-muted text-xs">Room is empty — type below to address the team.</div>}
        {log.map((e, i) => (
          <div key={i} className={e.kind === "user" ? "" : "rounded bg-warn/10 p-2"}>
            <div className="text-[10px] text-muted mono">
              {new Date(e.at).toLocaleTimeString()} · {e.kind === "user" ? "you" : "room"}
            </div>
            <div className="whitespace-pre-wrap text-xs">{e.text}</div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message the room… e.g. @claude @codex plan the next release"
          className="flex-1 bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
        <button type="submit" className="text-xs rounded bg-accent/20 text-accent px-4 py-2 hover:bg-accent/30">
          Send
        </button>
      </form>
    </div>
  );
}
