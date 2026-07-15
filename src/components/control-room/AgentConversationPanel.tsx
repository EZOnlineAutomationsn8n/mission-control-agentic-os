"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentConversationEntry } from "@/lib/agent-conversations/types";

const SESSION_ID = "operator-default";
const CLIENT_TIMEOUT_MS = 660000;

interface AgentSessionView {
  sessionKey: string;
  claudeSessionId?: string;
  runtimeSessionId?: string;
  displayName: string;
  workspace: string;
  permissionMode: string;
  executionMode: string;
  status: "starting" | "idle" | "running" | "stopped" | "error";
  active: boolean;
  lastError: string | null;
}

const RUNTIME_LABELS: Record<string, string> = {
  "claude-code": "Claude Code CLI 2.1.205",
  hermes: "Hermes Agent v0.18.0",
  openclaw: "OpenClaw 2026.6.9",
  agy: "Antigravity CLI 1.0.12",
  gemini: "Gemini CLI 0.50.0",
  codex: "Codex CLI 0.144.3",
};

const PROCESS_LABELS: Record<string, string> = {
  "claude-code": "on-demand CLI turn + persistent resumable session",
  hermes: "Hermes CLI turn + persistent resumable session",
  openclaw: "OpenClaw gateway turn + persistent explicit session",
  agy: "Antigravity sandbox print turn + persistent conversation",
  gemini: "Gemini CLI headless turn + persistent resumable session",
  codex: "Codex exec turn + persistent resumable thread",
};

function statusClass(status: AgentConversationEntry["status"]): string {
  return status === "completed" ? "text-ok" : status === "timeout" ? "text-warn" : "text-danger";
}

export function AgentConversationPanel({
  agentId,
  endpoint,
  label,
  terminal = false,
}: {
  agentId: string;
  endpoint: string;
  label: string;
  terminal?: boolean;
}) {
  const [entries, setEntries] = useState<AgentConversationEntry[]>([]);
  const [session, setSession] = useState<AgentSessionView | null>(null);
  const [bootstrap, setBootstrap] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  const historyEndpoint = `/api/agent-conversations/${agentId}/${SESSION_ID}`;
  const sessionEndpoint = `/api/connectors/${agentId}/session?sessionId=${SESSION_ID}`;
  const runtimeSessionId = session?.runtimeSessionId ?? session?.claudeSessionId ?? null;
  const runtimeLabel = RUNTIME_LABELS[agentId] ?? label;
  const processLabel = PROCESS_LABELS[agentId] ?? "persistent on-demand agent session";

  const loadState = useCallback(async () => {
    try {
      const [historyResponse, sessionResponse] = await Promise.all([
        fetch(historyEndpoint, { cache: "no-store" }),
        fetch(sessionEndpoint, { cache: "no-store" }),
      ]);
      const historyData = (await historyResponse.json()) as { entries?: AgentConversationEntry[]; error?: string };
      const sessionData = (await sessionResponse.json()) as { session?: AgentSessionView | null; error?: string };
      if (!historyResponse.ok) throw new Error(historyData.error ?? `history returned HTTP ${historyResponse.status}`);
      if (!sessionResponse.ok) throw new Error(sessionData.error ?? `session returned HTTP ${sessionResponse.status}`);
      setEntries(historyData.entries ?? []);
      setSession(sessionData.session ?? null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : `${label} session state unavailable`);
    } finally {
      setLoading(false);
    }
  }, [historyEndpoint, label, sessionEndpoint]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadState();
    });
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  async function lifecycle(action: "start" | "stop") {
    if (running) return;
    setRunning(true);
    setLoadError(null);
    setBootstrap(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch(sessionEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        session?: AgentSessionView | null;
        bootstrap?: string;
        error?: string;
        auditError?: string;
      };
      if (!response.ok) throw new Error(data.error ?? data.auditError ?? `session action returned HTTP ${response.status}`);
      setSession(data.session ?? null);
      setBootstrap(data.bootstrap ?? (action === "stop" ? `${label} session stopped.` : null));
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const message = aborted ? `${label} start timed out in the browser. Refresh to read server state.` :
        error instanceof Error ? error.message : `${label} session action failed`;
      await loadState();
      setLoadError(message);
    } finally {
      clearTimeout(timer);
      setRunning(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || running || !session?.active) return;
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
      await loadState();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const message = aborted ? `${label} turn timed out in the browser. Refresh to read the server-side result.` :
        error instanceof Error ? error.message : `${label} agent request failed`;
      await loadState();
      setLoadError(message);
    } finally {
      clearTimeout(timer);
      setRunning(false);
    }
  }

  async function clearConversation() {
    const response = await fetch(historyEndpoint, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
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

  const active = session?.active === true;
  const busy = running || session?.status === "starting" || session?.status === "running";

  return (
    <div className={terminal ? "h-full min-h-0 flex flex-col gap-3 p-3 bg-slate-950" : "rounded-lg border border-accent/40 bg-panel p-3 space-y-3"}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className={`text-[10px] uppercase tracking-wide mono ${busy ? "text-warn" : active ? "text-ok" : "text-muted"}`}>
          {busy ? "agent running" : active ? `session ${session?.status}` : "session stopped"}
        </span>
      </div>

      <div className="text-[10px] mono text-muted break-all">
        session <span className="text-foreground/90">{runtimeSessionId ?? "not started"}</span>
      </div>

      <div className={terminal ? "hidden" : "rounded border border-border bg-panel-2 p-2 text-[10px] mono space-y-1"}>
        <div><span className="text-muted">Agent identity:</span> <span className={active ? "text-ok" : "text-foreground"}>{label}</span></div>
        <div><span className="text-muted">Agent runtime:</span> {runtimeLabel}</div>
        <div><span className="text-muted">Process model:</span> {processLabel}</div>
        <div><span className="text-muted">Session:</span> {runtimeSessionId ?? "not started"}</div>
        <div><span className="text-muted">Workspace:</span> {session?.workspace ?? "assigned when session starts"}</div>
        <div><span className="text-muted">Permission mode:</span> {session?.permissionMode ?? "runtime policy"}</div>
      </div>

      <div className="flex gap-2">
        {!active ? (
          <button type="button" onClick={() => void lifecycle("start")} disabled={busy}
            className="text-xs rounded bg-ok/15 text-ok px-3 py-1.5 disabled:opacity-40">
            {busy ? `Starting ${label}...` : `Start ${label}`}
          </button>
        ) : (
          <button type="button" onClick={() => void lifecycle("stop")} disabled={busy}
            className="text-xs rounded bg-danger/10 text-danger px-3 py-1.5 disabled:opacity-40">
            Stop session
          </button>
        )}
      </div>

      {bootstrap && (
        <div className="rounded bg-ok/10 border border-ok/30 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-ok mb-1">{label} session bootstrap</div>
          <div className="mono whitespace-pre-wrap">{bootstrap}</div>
        </div>
      )}

      <div className={terminal ? "space-y-3 flex-1 min-h-0 overflow-y-auto" : "space-y-3 max-h-72 overflow-y-auto"} aria-label={`${label} conversation history`}>
        {loading && <div className="text-xs text-muted">Loading {label} session...</div>}
        {!loading && entries.length === 0 && <div className="text-xs text-muted">No {label} agent turns yet.</div>}
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-1.5 border-b border-border pb-3 last:border-0">
            <div className="rounded bg-accent/10 p-2 text-xs whitespace-pre-wrap"><span className="text-accent">You</span> - {entry.prompt}</div>
            <div className={`rounded bg-panel-2 p-2 text-xs ${statusClass(entry.status)}`}>
              <div className="text-[10px] uppercase tracking-wide mb-1">{label} Agent - {entry.status}</div>
              <div className="mono whitespace-pre-wrap break-words">{entry.text ?? entry.error ?? "No output returned."}</div>
            </div>
            <div className={terminal ? "hidden" : "text-[10px] text-muted mono space-y-0.5"}>
              <div>duration {(entry.durationMs / 1000).toFixed(1)}s - session {entry.agentSessionId ?? "not reported"}</div>
              <div>workspace {entry.workspace ?? "not reported"}</div>
              <div>provider/model {entry.transportModelAlias ?? entry.actualRuntimeModel ?? "not reported by agent runtime"}</div>
              <div>permission {entry.permissionMode ?? "not reported"}</div>
            </div>
          </div>
        ))}
      </div>

      {loadError && <div role="alert" className="rounded bg-danger/10 text-danger p-2 text-xs">{loadError}</div>}

      <form onSubmit={submit} className="space-y-2 shrink-0">
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={busy || !active} rows={3}
          placeholder={active ? `Send a prompt to ${label}...` : `Start ${label} before sending a prompt`}
          aria-label={`${label} agent prompt`}
          className="w-full resize-none bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent mono disabled:opacity-50" />
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => setClearConfirm(true)} disabled={busy || entries.length === 0}
            className="text-xs rounded bg-danger/10 text-danger px-3 py-1.5 disabled:opacity-40">Clear history</button>
          <button type="submit" disabled={busy || !active || !prompt.trim()}
            className="text-xs rounded bg-accent/20 text-accent px-3 py-1.5 disabled:opacity-40">
            {busy ? `${label} running...` : "Send"}
          </button>
        </div>
      </form>

      {clearConfirm && (
        <div role="dialog" aria-label="Confirm clear conversation" className="rounded border border-danger/40 bg-danger/10 p-3 text-xs space-y-2">
          <div>This clears Mission Control conversation history. It does not delete the agent runtime session. Continue?</div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setClearConfirm(false)} className="rounded bg-panel-2 px-2 py-1">Cancel</button>
            <button onClick={() => void clearConversation()} className="rounded bg-danger/20 text-danger px-2 py-1">Confirm clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
