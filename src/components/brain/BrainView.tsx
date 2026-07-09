"use client";

import { useEffect, useState } from "react";
import { obsidianAdapter } from "@/lib/connectors/registry";
import { vaultEngine, buildCopyPasteSessionBlock } from "@/lib/connectors/mock/obsidian-instance";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { SessionIndexEntry, VaultNote } from "@/lib/connectors/types";
import { timeAgo } from "@/lib/ui-helpers";

export function BrainView() {
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);
  const [handovers, setHandovers] = useState(vaultEngine.listHandovers());
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VaultNote[]>([]);
  const [sessionQuery, setSessionQuery] = useState("");
  const [copyBlock, setCopyBlock] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<VaultNote | null>(null);

  async function refresh() {
    setNotes(await obsidianAdapter.listVaultNotes());
    setSessions(await obsidianAdapter.readPreviousSessions({}));
    setHandovers(vaultEngine.listHandovers());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live mock adapter poll
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, []);

  const projectNotes = notes.filter((n) => n.kind === "project");
  const proofNotes = notes.filter((n) => n.kind === "proof");
  const governanceNotes = notes.filter((n) => n.kind === "governance");
  const folders = Array.from(new Set(notes.map((n) => n.folder))).sort();

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchResults(await obsidianAdapter.searchNotes(query));
  }

  const filteredSessions = sessions.filter((s) => {
    const q = sessionQuery.toLowerCase();
    if (!q) return true;
    return (
      s.agent.toLowerCase().includes(q) ||
      s.topic.toLowerCase().includes(q) ||
      s.sessionNumber.toLowerCase().includes(q)
    );
  });

  async function createDemoSessionEntry() {
    await obsidianAdapter.createSessionRegistryEntry({
      date: new Date().toISOString().slice(0, 10),
      agent: "Operator",
      system: "Mission Control shell",
      topic: "Manual session log",
      sessionId: null,
      title: "Manually logged operator session",
      summary: "Entry created from the Shared Brain UI to demonstrate the append-only session registry.",
      relatedFiles: [],
      obsidianLinks: [],
      status: "open",
      nextAction: "—",
      handover: null,
    });
    refresh();
  }

  function generateCopyPaste() {
    setCopyBlock(
      buildCopyPasteSessionBlock({
        date: new Date().toISOString().slice(0, 10),
        agent: "Unattached agent",
        system: "manual",
        topic: "Fallback entry (agent could not write directly)",
        sessionId: null,
        title: "Paste this block into AGENT_SESSION_INDEX.md",
        summary: "Generated because the originating agent had no direct write path to the vault.",
        relatedFiles: [],
        obsidianLinks: [],
        status: "open",
        nextAction: "Operator to paste into vault manually",
        handover: null,
      })
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Shared Brain — Obsidian Vault</h1>
        <p className="text-sm text-muted mt-1">
          Persistent substrate of the Agentic OS. {notes.length} notes across {folders.length} folders.
          Overwrites are never silent — attempts route to Approvals.
        </p>
      </div>

      {/* Vault overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total notes" value={notes.length} />
        <Stat label="Projects" value={projectNotes.length} />
        <Stat label="Proofs" value={proofNotes.length} />
        <Stat label="Governance" value={governanceNotes.length} />
        <Stat label="Handovers" value={handovers.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Latest notes */}
        <Section title="Latest notes">
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {notes.slice(0, 10).map((n) => (
              <NoteRow key={n.path} note={n} onOpen={() => setSelectedNote(n)} />
            ))}
          </div>
        </Section>

        {/* Project folders */}
        <Section title="Project folders">
          <div className="flex flex-wrap gap-1.5">
            {folders.map((f) => (
              <span key={f} className="text-xs mono rounded bg-panel-2 px-2 py-1">
                {f}
              </span>
            ))}
          </div>
        </Section>

        {/* Source/proof notes */}
        <Section title="Source / proof notes">
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {proofNotes.length === 0 && <div className="text-xs text-muted">None yet.</div>}
            {proofNotes.map((n) => (
              <NoteRow key={n.path} note={n} onOpen={() => setSelectedNote(n)} />
            ))}
          </div>
        </Section>

        {/* Governance records */}
        <Section title="Governance records">
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {governanceNotes.map((n) => (
              <NoteRow key={n.path} note={n} onOpen={() => setSelectedNote(n)} />
            ))}
          </div>
        </Section>

        {/* Session registry */}
        <Section
          title="Session registry — AGENT_SESSION_INDEX.md"
          action={
            <button
              onClick={createDemoSessionEntry}
              className="text-xs rounded bg-accent/20 text-accent px-2 py-1 hover:bg-accent/30"
            >
              Append demo entry
            </button>
          }
        >
          <input
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            placeholder="Search by agent, topic, or session number…"
            className="w-full bg-panel-2 rounded px-2 py-1.5 text-xs mono mb-2 outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {filteredSessions.map((s) => (
              <div key={s.sessionNumber} className="rounded border border-border bg-panel-2 p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium mono">{s.sessionNumber}</span>
                  <span className="text-muted">{s.date}</span>
                </div>
                <div className="text-muted">{s.agent} · {s.system}</div>
                <div className="mt-1">{s.title}</div>
                <div className="text-muted mt-1">Next: {s.nextAction}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-border pt-2">
            <button onClick={generateCopyPaste} className="text-xs text-accent hover:underline">
              Generate copy/paste fallback block (agent has no direct write path)
            </button>
            {copyBlock && (
              <pre className="mt-2 text-[10px] mono bg-panel-2 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {copyBlock}
              </pre>
            )}
          </div>
        </Section>

        {/* Agent handovers */}
        <Section title="Agent handovers">
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {handovers.length === 0 && <div className="text-xs text-muted">No handovers yet.</div>}
            {handovers.map((h) => (
              <div key={h.id} className="rounded border border-border bg-panel-2 p-2 text-xs">
                <div className="font-medium">
                  {h.fromAgentId} → {h.toAgentId ?? "unassigned"}
                </div>
                <div className="text-muted">{h.reason}</div>
                <div className="text-[10px] text-muted mt-1">{timeAgo(h.createdAt)} · {h.obsidianPath}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Backlinks / graph placeholder */}
      <Section title="Backlink graph (placeholder)">
        <div className="h-40 rounded border border-dashed border-border flex items-center justify-center text-xs text-muted">
          Graph view attaches here once a real Obsidian instance is connected — backlinks are already tracked per-note
          (see note detail).
        </div>
      </Section>

      {/* Search all notes */}
      <Section title="Search all vault notes">
        <form onSubmit={runSearch} className="flex gap-2 mb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, tags, folders, body…"
            className="flex-1 bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
          />
          <button className="text-xs rounded bg-accent/20 text-accent px-3 py-2 hover:bg-accent/30">Search</button>
        </form>
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {searchResults.map((n) => (
            <NoteRow key={n.path} note={n} onOpen={() => setSelectedNote(n)} />
          ))}
        </div>
      </Section>

      {/* Save arbitrary report to vault */}
      <SaveReportAction onSaved={refresh} />

      {selectedNote && <NoteModal note={selectedNote} onClose={() => setSelectedNote(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold mono">{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function NoteRow({ note, onOpen }: { note: VaultNote; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded bg-panel-2 hover:bg-border transition-colors px-2 py-1.5 text-xs"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium truncate">{note.title}</span>
        <span className="text-muted shrink-0 ml-2">{timeAgo(note.updatedAt)}</span>
      </div>
      <div className="text-muted mono truncate">{note.path}</div>
    </button>
  );
}

function NoteModal({ note, onClose }: { note: VaultNote; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-panel border border-border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">{note.title}</h2>
          <button onClick={onClose} className="text-xs text-muted hover:text-foreground">
            close
          </button>
        </div>
        <div className="text-xs text-muted mono mb-3">{note.path}</div>
        <pre className="text-xs whitespace-pre-wrap mono bg-panel-2 rounded p-3">{note.body}</pre>
        {note.backlinks.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="text-muted mb-1">Backlinks</div>
            {note.backlinks.map((b) => (
              <div key={b} className="mono">{b}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SaveReportAction({ onSaved }: { onSaved: () => void }) {
  const [agentId, setAgentId] = useState(connectorRegistry.list()[0]?.descriptor().id ?? "");
  const [reports, setReports] = useState<{ id: string; title: string; savedToBrain: boolean }[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    connectorRegistry
      .get(agentId)
      ?.listReports()
      .then((rs) => setReports(rs.map((r) => ({ id: r.id, title: r.title, savedToBrain: r.savedToBrain }))));
  }, [agentId]);

  return (
    <Section title="Save report to vault">
      <div className="flex gap-2 items-center flex-wrap text-xs">
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="bg-panel-2 rounded px-2 py-1.5"
        >
          {connectorRegistry.list().map((a) => (
            <option key={a.descriptor().id} value={a.descriptor().id}>
              {a.descriptor().name}
            </option>
          ))}
        </select>
        {reports.length === 0 && <span className="text-muted">No reports for this system.</span>}
        {reports.map((r) => (
          <button
            key={r.id}
            disabled={r.savedToBrain}
            onClick={async () => {
              await connectorRegistry.get(agentId)?.saveReportToBrain(r.id);
              setStatus(`Saved "${r.title}"`);
              onSaved();
            }}
            className="rounded bg-accent/20 text-accent px-2 py-1 hover:bg-accent/30 disabled:opacity-40"
          >
            {r.savedToBrain ? `${r.title} (saved)` : `Save "${r.title}"`}
          </button>
        ))}
      </div>
      {status && <div className="text-xs text-ok mt-2">{status}</div>}
    </Section>
  );
}
