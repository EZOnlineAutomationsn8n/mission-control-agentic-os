"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrainEvent, BrainSource } from "@/lib/shared-brain";

const classColor: Record<BrainSource["classification"], string> = {
  canonical: "text-ok bg-ok/15",
  candidate: "text-accent bg-accent/15",
  legacy: "text-warn bg-warn/15",
  archive: "text-muted bg-panel-2",
  duplicate: "text-danger bg-danger/10",
};

export function BrainView() {
  const [sources, setSources] = useState<BrainSource[]>([]);
  const [events, setEvents] = useState<BrainEvent[]>([]);
  const [scope, setScope] = useState("mission-control");
  const [summary, setSummary] = useState("");
  const [evidence, setEvidence] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [sourceResponse, eventResponse] = await Promise.all([
      fetch("/api/brain/sources", { cache: "no-store" }),
      fetch("/api/brain/events", { cache: "no-store" }),
    ]);
    const sourceBody = await sourceResponse.json() as { sources?: BrainSource[]; error?: string };
    const eventBody = await eventResponse.json() as { events?: BrainEvent[]; error?: string };
    if (!sourceResponse.ok) throw new Error(sourceBody.error || "Source register read failed");
    if (!eventResponse.ok) throw new Error(eventBody.error || "LifeFeed read failed");
    setSources(sourceBody.sources ?? []);
    setEvents(eventBody.events ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial read from the persistent Shared Brain API
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Shared Brain read failed"));
  }, [refresh]);

  const visibleSources = useMemo(
    () => filter === "all" ? sources : sources.filter((source) => source.scope === filter),
    [filter, sources]
  );
  const scopes = Array.from(new Set(sources.map((source) => source.scope))).sort();
  const duplicates = sources.filter((source) => source.classification === "duplicate").length;
  const candidates = sources.filter((source) => source.classification === "candidate").length;
  const canonical = sources.filter((source) => source.classification === "canonical").length;

  async function appendEvent(event: React.FormEvent) {
    event.preventDefault();
    if (!summary.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/brain/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: "operator",
          eventType: "state-update",
          scope,
          summary,
          evidence: evidence.split("\n").map((line) => line.trim()).filter(Boolean),
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "LifeFeed append failed");
      setSummary("");
      setEvidence("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "LifeFeed append failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Shared Brain</h1>
        <p className="text-sm text-muted mt-1">
          Evidence-backed source register and append-only continuity events. Source files are indexed read-only; none are silently promoted or rewritten.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Indexed sources" value={sources.length} />
        <Stat label="Canonical" value={canonical} />
        <Stat label="Candidates" value={candidates} />
        <Stat label="Exact duplicates" value={duplicates} />
      </div>

      {canonical === 0 && (
        <div className="rounded border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          No Mission Control continuity source has been declared canonical yet. Candidates remain candidates until operator acceptance.
        </div>
      )}
      {error && <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-4 items-start">
        <section className="rounded-lg border border-border bg-panel p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Continuity source register</h2>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded bg-panel-2 px-2 py-1 text-xs">
              <option value="all">All scopes</option>
              {scopes.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="space-y-2 max-h-[620px] overflow-y-auto">
            {visibleSources.map((source) => (
              <div key={source.id} className="rounded border border-border bg-panel-2 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{source.artifactKind} · {source.scope}</div>
                  <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${classColor[source.classification]}`}>{source.classification}</span>
                </div>
                <div className="mono break-all text-accent">{source.sourcePath}</div>
                <div className="text-muted">{source.notes}</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 text-[10px] text-muted">
                  <span>sha256</span><span className="mono truncate">{source.sha256}</span>
                  <span>bytes</span><span className="mono">{source.sizeBytes}</span>
                  <span>modified</span><span className="mono">{new Date(source.sourceModifiedAt).toLocaleString()}</span>
                </div>
                {source.duplicateOf && <div className="text-[10px] text-danger break-all">duplicate of: {source.duplicateOf}</div>}
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-4">
          <form onSubmit={appendEvent} className="rounded-lg border border-border bg-panel p-4 space-y-3">
            <h2 className="text-sm font-medium">Append continuity event</h2>
            <input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Scope" className="w-full rounded bg-panel-2 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent" />
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} placeholder="What actually changed?" required className="w-full resize-none rounded bg-panel-2 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent" />
            <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={3} placeholder="Evidence paths or URLs, one per line" className="w-full resize-none rounded bg-panel-2 px-3 py-2 text-xs mono outline-none focus:ring-1 focus:ring-accent" />
            <button type="submit" disabled={saving || !summary.trim()} className="rounded bg-accent/20 px-4 py-2 text-xs text-accent hover:bg-accent/30 disabled:opacity-40">{saving ? "Appending…" : "Append event"}</button>
          </form>

          <section className="rounded-lg border border-border bg-panel p-4">
            <h2 className="text-sm font-medium mb-3">LifeFeed events</h2>
            <div className="space-y-2 max-h-[380px] overflow-y-auto">
              {events.map((event) => (
                <div key={event.id} className="rounded border border-border bg-panel-2 p-3 text-xs space-y-1">
                  <div className="flex justify-between gap-2"><span className="text-accent">{event.scope}</span><span className="mono text-muted">{new Date(event.eventAt).toLocaleString()}</span></div>
                  <div>{event.summary}</div>
                  <div className="text-[10px] text-muted">{event.actor} · {event.eventType}</div>
                  {event.evidence.map((value) => <div key={value} className="text-[10px] mono break-all text-muted">{value}</div>)}
                </div>
              ))}
              {events.length === 0 && <div className="text-sm text-muted">No continuity events recorded yet.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-border bg-panel p-3"><div className="text-xs text-muted">{label}</div><div className="text-xl font-semibold mono">{value}</div></div>;
}
