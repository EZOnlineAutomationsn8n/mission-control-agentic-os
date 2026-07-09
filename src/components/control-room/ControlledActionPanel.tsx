"use client";

import { useState } from "react";
import { recordAction } from "@/lib/action-log-store";

type Phase =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "upstream_provider_failed"
  | "timeout"
  | "blocked"
  | "action_required";

interface ActionLogEntry {
  timestamp: string;
  connectorId: string;
  actionType: string;
  status: Phase;
}

interface GenericAttempt {
  transportModelAlias: string;
  actualRuntimeModel: string | null;
  outcome: string;
  error: string | null;
}

// Generic result shape any controlled-action endpoint may return. FCC's
// /ask adds actualRuntimeModel/transportModelAlias/attempts; n8n's
// /trigger doesn't — all are read structurally, extra fields render only
// when present.
interface GenericActionResult {
  status: Phase;
  text: string | null;
  error: string | null;
  actualRuntimeModel?: string | null;
  transportModelAlias?: string;
  attempts?: GenericAttempt[];
}

const PHASE_BADGE_CLASS: Record<Phase, string> = {
  idle: "text-muted bg-panel-2",
  running: "text-warn bg-warn/10",
  completed: "text-ok bg-ok/10",
  failed: "text-danger bg-danger/10",
  upstream_provider_failed: "text-danger bg-danger/10",
  timeout: "text-warn bg-warn/10",
  blocked: "text-warn bg-warn/10",
  action_required: "text-danger bg-danger/10",
};

// Generic controlled-action form: driven entirely by the `action` data an
// adapter's getState() supplies (see AgentSystemState.controlledAction).
// Submission is 100% explicit (a button click); nothing here polls,
// schedules, or auto-fires a request. Works for both a free-text prompt
// action (FCC) and a fixed no-input trigger action (n8n workflowTrigger)
// via `action.requiresInput`.
export function ControlledActionPanel({
  systemId,
  action,
}: {
  systemId: string;
  action: { id: string; label: string; endpoint: string; requiresInput?: boolean };
}) {
  const requiresInput = action.requiresInput ?? true;
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null);
  const [transportAlias, setTransportAlias] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<GenericAttempt[]>([]);
  const [log, setLog] = useState<ActionLogEntry[]>([]);

  function recordLog(status: Phase, resultSummary: string) {
    const timestamp = new Date().toISOString();
    const entry: ActionLogEntry = { timestamp, connectorId: systemId, actionType: action.id, status };
    setLog((prev) => [entry, ...prev].slice(0, 20));
    recordAction({ timestamp, connectorId: systemId, actionType: action.id, status, resultSummary });
  }

  async function run(text: string) {
    if (requiresInput && !text.trim()) return;
    if (phase === "running") return;
    setPhase("running");
    setAnswer(null);
    setError(null);
    setRuntimeModel(null);
    setAttempts([]);
    try {
      const res = await fetch(action.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requiresInput ? { prompt: text } : {}),
      });
      const data = (await res.json()) as GenericActionResult;
      setPhase(data.status);
      setAnswer(data.text);
      setError(data.error);
      setRuntimeModel(data.actualRuntimeModel ?? null);
      setTransportAlias(data.transportModelAlias ?? null);
      setAttempts(data.attempts ?? []);
      recordLog(data.status, data.text ?? data.error ?? "no result");
    } catch (e) {
      const message = e instanceof Error ? e.message : "request failed";
      setPhase("failed");
      setError(message);
      recordLog("failed", message);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run(prompt);
  }

  const canRetry =
    ["failed", "upstream_provider_failed", "timeout", "action_required"].includes(phase) &&
    (!requiresInput || prompt.trim().length > 0);

  return (
    <div className="rounded-lg border border-accent/40 bg-panel p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{action.label}</span>
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ${PHASE_BADGE_CLASS[phase]}`}>
          {phase}
        </span>
      </div>

      {requiresInput ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={phase === "running"}
            rows={3}
            placeholder="Send a plain-text task… (explicit submission only, no tools, no file/shell access)"
            className="w-full resize-none bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent mono disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={phase === "running" || !prompt.trim()}
            className="self-end text-xs rounded bg-accent/20 text-accent px-3 py-1.5 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {phase === "running" ? "Running…" : "Send"}
          </button>
        </form>
      ) : (
        <button
          onClick={() => run("trigger")}
          disabled={phase === "running"}
          className="text-xs rounded bg-accent/20 text-accent px-3 py-1.5 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {phase === "running" ? "Running…" : "Attempt trigger"}
        </button>
      )}

      {(runtimeModel || transportAlias) && (
        <div className="text-[11px] text-muted">
          runtime model: <span className="mono text-foreground/90">{runtimeModel ?? "unknown"}</span>
          {transportAlias && (
            <>
              {" "}
              · transport alias: <span className="mono">{transportAlias}</span>
            </>
          )}
        </div>
      )}

      {answer && (
        <div className="rounded bg-panel-2 p-2 text-xs mono whitespace-pre-wrap break-words">{answer}</div>
      )}

      {phase === "action_required" && attempts.length > 0 ? (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 space-y-2">
          <div className="text-xs font-semibold text-danger uppercase tracking-wide">Action required</div>
          <div className="text-xs text-foreground/90">
            No configured model route returned a real answer. This is not a success — every route below was
            actually attempted and actually failed.
          </div>
          <div className="space-y-1">
            {attempts.map((a, i) => (
              <div key={i} className="rounded bg-panel-2 p-2 text-[11px] mono">
                <div>
                  route: <span className="text-foreground/90">{a.transportModelAlias}</span>
                  {a.actualRuntimeModel && <> → {a.actualRuntimeModel}</>}
                </div>
                <div className="text-danger">
                  outcome: {a.outcome}
                  {a.error ? ` — ${a.error}` : ""}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-warn">
            Exact fix needed: configure a working model route for this system (MODEL / MODEL_OPUS / MODEL_SONNET /
            MODEL_HAIKU in FCC&apos;s environment) or confirm the upstream provider (OpenRouter) is reachable and
            not rate-limited for the routes attempted above, then retry.
          </div>
        </div>
      ) : (
        error && <div className="rounded bg-danger/10 text-danger p-2 text-xs break-words">{error}</div>
      )}
      {canRetry && (
        <button
          onClick={() => run(prompt || "trigger")}
          className="text-xs rounded bg-warn/20 text-warn px-3 py-1.5 hover:bg-warn/30"
        >
          Retry
        </button>
      )}

      {log.length > 0 && (
        <div className="text-[10px] text-muted border-t border-border pt-2 space-y-0.5 max-h-24 overflow-y-auto">
          {log.map((l, i) => (
            <div key={i} className="mono">
              {new Date(l.timestamp).toLocaleTimeString()} — {l.connectorId} — {l.actionType} — {l.status}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
