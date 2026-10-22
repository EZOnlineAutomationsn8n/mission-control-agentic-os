"use client";

import { useState } from "react";
import { FocusablePanel } from "@/components/shell/PanelFocus";

const AGENTS = [
  { id: "claude-code", label: "Claude Code", ready: true },
  { id: "hermes", label: "Hermes", ready: true },
  { id: "agy", label: "Antigravity", ready: true },
  { id: "openclaw", label: "OpenClaw", ready: true },
  { id: "codex", label: "Codex", ready: true },
  { id: "gemini", label: "Gemini", ready: false },
] as const;

interface DispatchResult {
  target: string;
  status: string;
  text?: string | null;
  error?: string | null;
  agentIdentity?: string | null;
  agentRuntime?: string | null;
  agentSessionId?: string | null;
  actualRuntimeModel?: string | null;
}

interface RoomEntry {
  id: string;
  at: string;
  message: string;
  status: string;
  durationMs: number;
  results: DispatchResult[];
}

export default function MastermindPage() {
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<string[]>(AGENTS.filter((agent) => agent.ready).map((agent) => agent.id));
  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(agentId: string) {
    setSelected((current) => current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/mastermind/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, targets: selected, sessionId: "mastermind-operator" }),
      });
      const payload = await response.json() as {
        error?: string;
        status?: string;
        durationMs?: number;
        results?: DispatchResult[];
      };
      if (!response.ok || !payload.results) throw new Error(payload.error || `dispatch returned HTTP ${response.status}`);
      const results = payload.results;
      setEntries((current) => [...current, {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        message,
        status: payload.status || "unknown",
        durationMs: payload.durationMs || 0,
        results,
      }]);
      setInput("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "dispatch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-lg font-semibold">AI Agent Mastermind</h1>
        <p className="text-sm text-muted mt-1">One operator message, real parallel turns, one persistent room.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {AGENTS.map((agent) => {
          const active = selected.includes(agent.id);
          return (
            <button key={agent.id} type="button" onClick={() => toggle(agent.id)} className={`rounded-full border px-3 py-1.5 text-xs ${active ? "border-accent bg-accent/15 text-accent" : "border-border bg-panel-2 text-muted"}`}>
              <span className="status-dot mr-1.5" style={{ backgroundColor: agent.ready ? "var(--ok)" : "var(--warn)" }} />
              {agent.label}{!agent.ready ? " · login required" : ""}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-xs">
        <span className="font-semibold text-ok uppercase tracking-wide">Real dispatch connected</span>
        <span className="ml-2">Claude Code, Hermes, Antigravity, OpenClaw and Codex are available. Gemini remains selectable and returns its exact login blocker.</span>
      </div>

      {error && <div className="rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</div>}

      <FocusablePanel id="mastermind-dispatch" label="AI Agent Mastermind · Dispatch" className="min-h-0">
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {entries.length === 0 && <div className="rounded-lg border border-border bg-panel p-4 text-xs text-muted">No dispatches yet.</div>}
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-border bg-panel p-4 space-y-3">
            <div className="flex justify-between gap-3 text-xs">
              <span className="font-medium">You: {entry.message}</span>
              <span className="mono text-muted">{entry.status} · {entry.durationMs} ms</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {entry.results.map((result) => (
                <div key={result.target} className={`rounded border p-3 text-xs ${result.status === "completed" ? "border-ok/30 bg-ok/5" : "border-danger/30 bg-danger/5"}`}>
                  <div className="flex justify-between gap-2 mb-2">
                    <span className="font-semibold">{result.agentIdentity || result.target}</span>
                    <span className="mono text-muted">{result.status}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words">{result.text || result.error || "No response text"}</div>
                  <div className="mt-2 text-[10px] text-muted mono">{result.agentRuntime || "runtime unavailable"} · session {result.agentSessionId || "unavailable"}{result.actualRuntimeModel ? ` · ${result.actualRuntimeModel}` : ""}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={3} placeholder="Give the selected agents one concrete assignment…" className="flex-1 resize-none rounded bg-panel-2 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent" />
        <button disabled={busy || !input.trim() || selected.length === 0} type="submit" className="self-stretch rounded bg-accent/20 px-5 text-xs text-accent enabled:hover:bg-accent/30 disabled:opacity-40">
          {busy ? "Running…" : `Dispatch ${selected.length}`}
        </button>
      </form>
      </FocusablePanel>
    </div>
  );
}
