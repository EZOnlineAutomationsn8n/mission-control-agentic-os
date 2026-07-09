"use client";

import { useState } from "react";
import { portMontageProject, type LeadStatus } from "@/mocks/portmontage";
import { obsidianAdapter } from "@/lib/connectors/registry";
import type { VaultNote } from "@/lib/connectors/types";
import { dotGlowStyle } from "@/lib/ui-helpers";

const LANES: LeadStatus[] = ["raw", "verified", "contact-ready", "rejected"];

const laneColor: Record<LeadStatus, string> = {
  raw: "#6b7a8a",
  verified: "#5aa6ff",
  "contact-ready": "#35e0c2",
  rejected: "#f2554b",
};

export function ProjectLayer() {
  const [selectedProof, setSelectedProof] = useState<VaultNote | null>(null);

  async function openProof(path: string) {
    const note = await obsidianAdapter.readNote(path);
    setSelectedProof(note);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Project Layer — {portMontageProject.name}</h1>
        <p className="text-sm text-muted mt-1">{portMontageProject.summary}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="text-xs text-muted mb-2">Countries</div>
          <div className="flex flex-wrap gap-1.5">
            {portMontageProject.countries.map((c) => (
              <span key={c} className="text-xs rounded bg-panel-2 px-2 py-1">
                {c}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="text-xs text-muted mb-2">Sectors</div>
          <div className="flex flex-wrap gap-1.5">
            {portMontageProject.sectors.map((s) => (
              <span key={s} className="text-xs rounded bg-panel-2 px-2 py-1">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-3">Lead status pipeline</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {LANES.map((lane) => (
            <div key={lane} className="rounded-lg border border-border bg-panel p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
                <span className="status-dot" style={dotGlowStyle(laneColor[lane])} />
                {lane}
                <span className="ml-auto mono text-muted">
                  {portMontageProject.companies.filter((c) => c.leadStatus === lane).length}
                </span>
              </div>
              {portMontageProject.companies
                .filter((c) => c.leadStatus === lane)
                .map((c) => (
                  <div key={c.id} className="rounded border border-border bg-panel-2 p-2 text-xs space-y-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-muted">{c.country} · {c.sector}</div>
                    <div className="text-muted">{c.workforceNeed}</div>
                    {c.contact && <div className="mono">{c.contact}</div>}
                    {c.sourceProofPath && (
                      <button
                        onClick={() => openProof(c.sourceProofPath!)}
                        className="text-accent hover:underline"
                      >
                        view source proof
                      </button>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>

      {selectedProof && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
          onClick={() => setSelectedProof(null)}
        >
          <div
            className="bg-panel border border-border rounded-lg max-w-xl w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">{selectedProof.title}</h2>
              <button onClick={() => setSelectedProof(null)} className="text-xs text-muted hover:text-foreground">
                close
              </button>
            </div>
            <div className="text-xs text-muted mono mb-3">{selectedProof.path}</div>
            <pre className="text-xs whitespace-pre-wrap mono bg-panel-2 rounded p-3">{selectedProof.body}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
