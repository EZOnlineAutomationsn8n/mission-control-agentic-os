"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrainEvent, BrainSource } from "@/lib/shared-brain";
import { FocusablePanel } from "@/components/shell/PanelFocus";

interface OmiStatus {
  status: "connected" | "blocked" | "rate_limited" | "error";
  authentication: "authorized" | "configured_unverified" | "missing" | "rejected";
  endpoint: string;
  availableTools: string[];
  counts: { memories: number | null; conversations: number | null };
  intakeDirectory: string;
  canonicalVaultMutation: false;
  errors: string[];
}

interface OmiReceipt {
  counts: { memories: number; conversations: number };
  receiptPath: string;
  canonicalVaultMutation: false;
}

interface BrainBindingStatus {
  status: "connected" | "degraded" | "disconnected";
  source: string;
  authoritySource: string;
  bindingKind: "derived-readonly-projection" | "direct-readonly-vault";
  projectionFingerprint: string | null;
  projectionGeneratedAt: string | null;
  projectionNoteCount: number | null;
  projectionContentPolicy: string | null;
  canonicalByDisplay: false;
}

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
  const [omiStatus, setOmiStatus] = useState<OmiStatus | null>(null);
  const [omiReceipt, setOmiReceipt] = useState<OmiReceipt | null>(null);
  const [omiImporting, setOmiImporting] = useState(false);
  const [bindingStatus, setBindingStatus] = useState<BrainBindingStatus | null>(null);

  const refresh = useCallback(async () => {
    const [sourceResponse, eventResponse, omiResponse, bindingResponse] = await Promise.all([
      fetch("/api/brain/sources", { cache: "no-store" }),
      fetch("/api/brain/events", { cache: "no-store" }),
      fetch("/api/connectors/omi/status", { cache: "no-store" }),
      fetch("/api/connectors/obsidian/status", { cache: "no-store" }),
    ]);
    const sourceBody = await sourceResponse.json() as { sources?: BrainSource[]; error?: string };
    const eventBody = await eventResponse.json() as { events?: BrainEvent[]; error?: string };
    const omiBody = await omiResponse.json() as OmiStatus;
    const bindingBody = await bindingResponse.json() as BrainBindingStatus;
    if (!sourceResponse.ok) throw new Error(sourceBody.error || "Source register read failed");
    if (!eventResponse.ok) throw new Error(eventBody.error || "LifeFeed read failed");
    if (!omiResponse.ok) throw new Error("OMI status read failed");
    if (!bindingResponse.ok) throw new Error("Shared Brain binding status read failed");
    setSources(sourceBody.sources ?? []);
    setEvents(eventBody.events ?? []);
    setOmiStatus(omiBody);
    setBindingStatus(bindingBody);
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

  async function importOmi() {
    setOmiImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/connectors/omi/intake", { method: "POST" });
      const body = await response.json() as { receipt?: OmiReceipt; error?: string };
      if (!response.ok || !body.receipt) throw new Error(body.error || "OMI intake failed");
      setOmiReceipt(body.receipt);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OMI intake failed");
    } finally {
      setOmiImporting(false);
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

      <section className="rounded-lg border border-accent/30 bg-panel p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Shared Brain authority binding</h2>
          <span className={bindingStatus?.status === "connected" ? "text-xs text-ok" : "text-xs text-warn"}>
            {bindingStatus?.status ?? "checking"}
          </span>
        </div>
        <p className="text-xs text-muted">
          The durable ViREON vault is the knowledge authority. Mission Control reads a derived read-only surface and indexes metadata in PostgreSQL; neither projection nor database becomes canonical by being displayed here.
        </p>
        <div className="grid grid-cols-1 gap-1 text-[11px] md:grid-cols-[auto_1fr] md:gap-x-3">
          <span className="text-muted">Authority source</span><span className="mono break-all">{bindingStatus?.authoritySource ?? "checking"}</span>
          <span className="text-muted">MC read surface</span><span className="mono break-all">{bindingStatus?.source ?? "checking"}</span>
          <span className="text-muted">Binding</span><span className="mono">{bindingStatus?.bindingKind ?? "checking"}</span>
          <span className="text-muted">Projection fingerprint</span><span className="mono break-all">{bindingStatus?.projectionFingerprint ?? "direct / unavailable"}</span>
          <span className="text-muted">Projection generated</span><span className="mono">{bindingStatus?.projectionGeneratedAt ? new Date(bindingStatus.projectionGeneratedAt).toLocaleString() : "direct / unavailable"}</span>
          <span className="text-muted">Projection notes</span><span className="mono">{bindingStatus?.projectionNoteCount ?? "—"}</span>
          <span className="text-muted">DB source register</span><span>derived index · canonical-by-display: no</span>
        </div>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Indexed sources" value={sources.length} />
        <Stat label="Canonical" value={canonical} />
        <Stat label="Candidates" value={candidates} />
        <Stat label="Exact duplicates" value={duplicates} />
      </div>

      {canonical === 0 && (
        <div className="rounded border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          No individual source-register row is operator-declared canonical. This does not demote the durable ViREON vault authority shown above; the database register is a derived index and candidates remain candidates until operator acceptance.
        </div>
      )}
      {error && <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <section className="rounded-lg border border-border bg-panel p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">OMI → Obsidian candidate intake</h2>
            <p className="mt-1 text-xs text-muted">
              Official OMI MCP read route. Imports only into the sandbox intake; the canonical vault is never changed.
            </p>
          </div>
          <button
            type="button"
            onClick={importOmi}
            disabled={omiImporting || omiStatus?.status !== "connected"}
            className="rounded bg-accent/20 px-4 py-2 text-xs text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            {omiImporting ? "Importing…" : "Run candidate intake"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
          <OmiFact label="Route" value={omiStatus?.status ?? "checking"} />
          <OmiFact label="Authentication" value={omiStatus?.authentication ?? "checking"} />
          <OmiFact label="Memories" value={omiStatus?.counts.memories ?? "—"} />
          <OmiFact label="Conversations" value={omiStatus?.counts.conversations ?? "—"} />
          <OmiFact label="MCP tools" value={omiStatus?.availableTools.length ?? "—"} />
          <OmiFact label="Canonical writes" value="0" />
        </div>
        {omiStatus?.errors.map((message) => <div key={message} className="text-xs text-danger">{message}</div>)}
        {omiReceipt && (
          <div className="rounded border border-ok/30 bg-ok/10 p-3 text-xs text-ok">
            Intake receipt written · {omiReceipt.counts.memories} memories · {omiReceipt.counts.conversations} conversations · 0 canonical writes
            <div className="mt-1 break-all font-mono text-[10px]">{omiReceipt.receiptPath}</div>
          </div>
        )}
        {omiStatus && (
          <div className="space-y-1 break-all font-mono text-[10px] text-muted">
            <div>MCP endpoint: {omiStatus.endpoint}</div>
            <div>candidate destination: {omiStatus.intakeDirectory}</div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-4 items-start">
        <FocusablePanel id="brain-sources" label="Shared Brain · Continuity source register">
        <section className="rounded-lg border border-border bg-panel p-4 space-y-3 h-full">
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
        </FocusablePanel>

        <FocusablePanel id="brain-continuity" label="Shared Brain · Continuity events">
        <div className="space-y-4 h-full">
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
        </FocusablePanel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-border bg-panel p-3"><div className="text-xs text-muted">{label}</div><div className="text-xl font-semibold mono">{value}</div></div>;
}

function OmiFact({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded border border-border bg-panel-2 p-2"><div className="text-[10px] text-muted">{label}</div><div className="mt-1 font-mono">{value}</div></div>;
}
