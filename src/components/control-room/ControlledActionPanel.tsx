"use client";

import { useEffect, useRef, useState } from "react";
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
  routeNumber?: number;
  transportModelAlias: string;
  actualRuntimeModel: string | null;
  outcome: string;
  error: string | null;
  latencyMs?: number;
  lastKnownGood?: boolean;
}

// Generic result shape any controlled-action endpoint may return. FCC's
// /ask adds attempts/routeCount/skippedRouteNumbers; other actions don't —
// all fields are read structurally and render only when present.
interface GenericActionResult {
  status: Phase;
  text: string | null;
  error: string | null;
  actualRuntimeModel?: string | null;
  transportModelAlias?: string;
  attempts?: GenericAttempt[];
  routeCount?: number;
  skippedRouteNumbers?: number[];
}

const CLIENT_TIMEOUT_MS = 75000;

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

function attemptTone(outcome: string): string {
  return outcome === "completed" ? "text-ok" : "text-danger";
}

// Generic controlled-action form: driven entirely by the `action` data an
// adapter's getState() supplies. Submission is 100% explicit (a button
// click); nothing here polls, schedules, or auto-fires a request. The
// running state ALWAYS resolves: server outcome, client-side 75s abort, or
// exception — each path clears the phase and the elapsed ticker.
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
  const [routeCount, setRouteCount] = useState<number | null>(null);
  const [skippedRoutes, setSkippedRoutes] = useState<number[]>([]);
  const [elapsedS, setElapsedS] = useState(0);
  const [log, setLog] = useState<ActionLogEntry[]>([]);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  function startTicker() {
    setElapsedS(0);
    const t0 = Date.now();
    tickerRef.current = setInterval(() => setElapsedS(Math.round((Date.now() - t0) / 1000)), 1000);
  }

  function stopTicker() {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }

  function summarize(data: GenericActionResult): string {
    const win = data.attempts?.find((a) => a.outcome === "completed");
    if (win && data.attempts) {
      const failedBefore = data.attempts.length - 1;
      return `[route ${win.routeNumber ?? "?"}/${data.routeCount ?? data.attempts.length} ${win.transportModelAlias} · ${failedBefore} failed] ${data.text ?? ""}`;
    }
    if (data.attempts && data.attempts.length > 0) {
      return `[${data.attempts.length} route(s) failed${data.skippedRouteNumbers?.length ? `, ${data.skippedRouteNumbers.length} skipped` : ""}] ${data.error ?? "no result"}`;
    }
    return data.text ?? data.error ?? "no result";
  }

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
    setTransportAlias(null);
    setAttempts([]);
    setSkippedRoutes([]);
    startTicker();

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch(action.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requiresInput ? { prompt: text } : {}),
        signal: controller.signal,
      });
      const data = (await res.json()) as GenericActionResult;
      setPhase(data.status);
      setAnswer(data.text);
      setError(data.error);
      setRuntimeModel(data.actualRuntimeModel ?? null);
      setTransportAlias(data.transportModelAlias ?? null);
      setAttempts(data.attempts ?? []);
      setRouteCount(data.routeCount ?? null);
      setSkippedRoutes(data.skippedRouteNumbers ?? []);
      recordLog(data.status, summarize(data));
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      const message = aborted
        ? `client timeout after ${Math.round(CLIENT_TIMEOUT_MS / 1000)}s — request aborted (server may still be retrying routes)`
        : e instanceof Error
          ? e.message
          : "request failed";
      setPhase(aborted ? "timeout" : "failed");
      setError(message);
      recordLog(aborted ? "timeout" : "failed", message);
    } finally {
      clearTimeout(abortTimer);
      stopTicker();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run(prompt);
  }

  const canRetry =
    ["failed", "upstream_provider_failed", "timeout", "action_required"].includes(phase) &&
    (!requiresInput || prompt.trim().length > 0);

  const winning = attempts.find((a) => a.outcome === "completed");
  const failedCount = attempts.filter((a) => a.outcome !== "completed").length;

  return (
    <div className="rounded-lg border border-accent/40 bg-panel p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{action.label}</span>
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ${PHASE_BADGE_CLASS[phase]}`}>
          {phase === "running" ? `running ${elapsedS}s` : phase}
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
            {phase === "running" ? `Running… ${elapsedS}s` : "Send"}
          </button>
        </form>
      ) : (
        <button
          onClick={() => run("trigger")}
          disabled={phase === "running"}
          className="text-xs rounded bg-accent/20 text-accent px-3 py-1.5 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {phase === "running" ? `Running… ${elapsedS}s` : "Attempt trigger"}
        </button>
      )}

      {phase === "running" && (
        <div className="text-[11px] text-warn">
          Trying routes in operator order (1..{routeCount ?? 10}) — up to 60s server budget, {Math.round(CLIENT_TIMEOUT_MS / 1000)}s client cutoff.
        </div>
      )}

      {winning && (
        <div className="text-[11px] text-ok">
          answered by route #{winning.routeNumber ?? "?"}/{routeCount ?? attempts.length}:{" "}
          <span className="mono">{winning.transportModelAlias}</span>
          {winning.lastKnownGood && " (tried first — last known good)"} · {failedCount} failed route
          {failedCount === 1 ? "" : "s"} before success ·{" "}
          {winning.latencyMs !== undefined ? `${(winning.latencyMs / 1000).toFixed(1)}s` : ""}
        </div>
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
        <div className="rounded bg-panel-2 p-2 text-xs space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted">
            raw model output — {runtimeModel ?? "unknown model"} (not a Claude Code agent)
          </div>
          <div className="mono whitespace-pre-wrap break-words">{answer}</div>
        </div>
      )}

      {attempts.length > 0 && (
        <div className="rounded border border-border bg-panel-2/60 p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted">
            attempt trail — operator route order is fixed 1..{routeCount ?? attempts.length}
          </div>
          {attempts.map((a, i) => (
            <div key={i} className="text-[11px] mono flex gap-2 min-w-0">
              <span className="text-muted shrink-0">#{a.routeNumber ?? i + 1}</span>
              <span className="truncate">{a.transportModelAlias}</span>
              <span className={`${attemptTone(a.outcome)} shrink-0`}>{a.outcome}</span>
              <span className="text-muted shrink-0">
                {a.latencyMs !== undefined ? `${(a.latencyMs / 1000).toFixed(1)}s` : ""}
              </span>
            </div>
          ))}
          {skippedRoutes.length > 0 && (
            <div className="text-[11px] text-warn">
              not attempted (budget exhausted): routes {skippedRoutes.join(", ")}
            </div>
          )}
        </div>
      )}

      {phase === "action_required" && attempts.length > 0 ? (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 space-y-2">
          <div className="text-xs font-semibold text-danger uppercase tracking-wide">Action required</div>
          <div className="text-xs text-foreground/90">
            No route returned a real answer within the budget. This is not a success — every route listed above was
            actually attempted with the exact error shown.
          </div>
          <div className="space-y-1">
            {attempts
              .filter((a) => a.error)
              .map((a, i) => (
                <div key={i} className="rounded bg-panel-2 p-2 text-[11px] mono">
                  <div>
                    #{a.routeNumber ?? "?"} {a.transportModelAlias}
                    {a.actualRuntimeModel && <> → {a.actualRuntimeModel}</>}
                  </div>
                  <div className="text-danger">
                    {a.outcome}
                    {a.error ? ` — ${a.error}` : ""}
                  </div>
                </div>
              ))}
          </div>
          <div className="text-xs text-warn">
            Exact fix needed: free routes are rate-limited or down — retry shortly, or adjust the operator route
            order / FCC MODEL configuration, or confirm OpenRouter is reachable for the routes above.
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
