"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentConversationEntry } from "@/lib/agent-conversations/types";

const SESSION_ID = "operator-default";
const CLIENT_TIMEOUT_MS = 75000;

function statusClass(status: AgentConversationEntry["status"]): string {
  return status === "completed" ? "text-ok" : status === "timeout" ? "text-warn" : "text-danger";
}

export function AgentConversationPanel({
  agentId,
  endpoint,
  label,
}: {
  agentId: string;
  endpoint: string;
  label: string;
}) {
  const [entries, setEntries] = useState<AgentConversationEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  const historyEndpoint = `/api/agent-conversations/${agentId}/${SESSION_ID}`;
  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(historyEndpoint, { cache: "no-store" });
      const data = (await response.json()) as { entries?: AgentConversationEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `history returned HTTP ${response.status}`);
      setEntries(data.entries ?? []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "conversation history unavailable");
    } finally {
      setLoading(false);
    }
  }, [historyEndpoint]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial server-side history read
    void loadHistory();
  }, [loadHistory]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || running) return;
    const submittedPrompt = prompt.trim();
    setRunning(true);
    setLoadError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: submittedPrompt, sessionId: SESSION_ID }),
        signal: controller.signal,
      });
      const data = (await response.json()) as AgentConversationEntry & { error?: string; auditError?: string };
      if (!data.id) throw new Error(data.auditError ?? data.error ?? `request returned HTTP ${response.status}`);
      setEntries((current) => [...current, data]);
      setPrompt("");
      if (!response.ok) setLoadError(data.auditError ?? "request persisted but audit recording failed");
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      setLoadError(aborted
        ? `Browser timeout after ${CLIENT_TIMEOUT_MS / 1000}s. Refresh to read the server-side final result.`
        : error instanceof Error ? error.message : "connector request failed");
      await loadHistory();
    } finally {
      clearTimeout(timer);
      setRunning(false);
    }
  }

  async function clearConversation() {
    const response = await fetch(historyEndpoint, {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "CLEAR CONVERSATION" }),
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      setLoadError(data.error ?? `clear returned HTTP ${response.status}`);
      return;
    }
    setEntries([]);
    setClearConfirm(false);
  }

  return (
    <div className="rounded-lg border border-accent/40 bg-panel p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span className={`text-[10px] uppercase tracking-wide mono ${running ? "text-warn" : "text-muted"}`}>
          {running ? "sending / running" : `${entries.length} saved exchange${entries.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="space-y-3 max-h-72 overflow-y-auto" aria-label="Conversation history">
        {loading && <div className="text-xs text-muted">Loading server-side conversation…</div>}
        {!loading && entries.length === 0 && <div className="text-xs text-muted">No conversation yet.</div>}
        {entries.map((entry) => {
          const winner = entry.attempts.find((attempt) => attempt.outcome === "completed");
          const failed = entry.attempts.filter((attempt) => attempt.outcome !== "completed");
          return (
            <div key={entry.id} className="space-y-1.5 border-b border-border pb-3 last:border-0">
              <div className="rounded bg-accent/10 p-2 text-xs whitespace-pre-wrap"><span className="text-accent">You</span> · {entry.prompt}</div>
              <div className={`rounded bg-panel-2 p-2 text-xs ${statusClass(entry.status)}`}>
                <div className="text-[10px] uppercase tracking-wide mb-1">FCC · {entry.status}</div>
                <div className="mono whitespace-pre-wrap break-words">{entry.text ?? entry.error ?? "No output returned."}</div>
              </div>
              <div className="text-[10px] text-muted mono">
                duration {(entry.durationMs / 1000).toFixed(1)}s
                {winner ? ` · route #${winner.routeNumber ?? "?"}/${entry.routeCount ?? "?"} ${winner.transportModelAlias}` : ""}
                {entry.actualRuntimeModel ? ` · model ${entry.actualRuntimeModel}` : ""}
                {failed.length ? ` · ${failed.length} failed attempt${failed.length === 1 ? "" : "s"}` : ""}
              </div>
              {failed.length > 0 && (
                <details className="text-[10px] text-danger">
                  <summary className="cursor-pointer">Failed routes / fallback evidence</summary>
                  {failed.map((attempt, index) => <div key={index} className="mono mt-1">#{attempt.routeNumber ?? "?"} {attempt.transportModelAlias} · {attempt.outcome} · {attempt.error}</div>)}
                </details>
              )}
            </div>
          );
        })}
      </div>

      {loadError && <div role="alert" className="rounded bg-danger/10 text-danger p-2 text-xs">{loadError}</div>}

      <form onSubmit={submit} className="space-y-2">
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={running} rows={3}
          placeholder="Type a prompt for Free Claude Code…" aria-label="Prompt"
          className="w-full resize-none bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent mono disabled:opacity-50" />
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => setClearConfirm(true)} disabled={running || entries.length === 0}
            className="text-xs rounded bg-danger/10 text-danger px-3 py-1.5 disabled:opacity-40">Clear conversation</button>
          <button type="submit" disabled={running || !prompt.trim()}
            className="text-xs rounded bg-accent/20 text-accent px-3 py-1.5 disabled:opacity-40">
            {running ? "Sending / running…" : "Send"}
          </button>
        </div>
      </form>

      {clearConfirm && (
        <div role="dialog" aria-label="Confirm clear conversation" className="rounded border border-danger/40 bg-danger/10 p-3 text-xs space-y-2">
          <div>This permanently clears this agent session from the server. Continue?</div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setClearConfirm(false)} className="rounded bg-panel-2 px-2 py-1">Cancel</button>
            <button onClick={() => void clearConversation()} className="rounded bg-danger/20 text-danger px-2 py-1">Confirm clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
