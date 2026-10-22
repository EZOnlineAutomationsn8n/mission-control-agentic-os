"use client";

import { useCallback, useEffect, useState } from "react";
import type { OperatorProject, OperatorWorkItem, WorkStage } from "@/lib/operator-work";
import { FocusablePanel } from "@/components/shell/PanelFocus";

const COLUMNS: WorkStage[] = ["capture", "human-gate", "execute", "shipped"];

export default function PipelinePage() {
  const [items, setItems] = useState<OperatorWorkItem[]>([]);
  const [projects, setProjects] = useState<OperatorProject[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [itemsResponse, projectsResponse] = await Promise.all([
      fetch("/api/work-items", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" }),
    ]);
    const itemsBody = await itemsResponse.json() as { items?: OperatorWorkItem[]; error?: string };
    const projectsBody = await projectsResponse.json() as { projects?: OperatorProject[]; error?: string };
    if (!itemsResponse.ok) throw new Error(itemsBody.error || "Work item read failed");
    if (!projectsResponse.ok) throw new Error(projectsBody.error || "Project read failed");
    setItems(itemsBody.items ?? []);
    setProjects(projectsBody.projects ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial read from the persistent operator work API
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Pipeline read failed"));
  }, [refresh]);

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/work-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, projectId: projectId || null }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Work item create failed");
      setTitle("");
      setDescription("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Work item create failed");
    } finally {
      setBusy(false);
    }
  }

  async function move(item: OperatorWorkItem, direction: -1 | 1) {
    const next = COLUMNS[COLUMNS.indexOf(item.stage) + direction];
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/work-items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: next }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Stage transition failed");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stage transition failed");
    } finally {
      setBusy(false);
    }
  }

  const projectName = (id: string | null) => projects.find((project) => project.id === id)?.name ?? "Unscoped";

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Execution Pipeline</h1>
        <p className="text-sm text-muted mt-1">
          Persistent lifecycle: capture → human gate → execute → shipped. Moving into execute is the explicit operator release.
        </p>
      </div>

      <form onSubmit={addItem} className="rounded-lg border border-border bg-panel p-3 grid grid-cols-1 lg:grid-cols-[1fr_1fr_220px_auto] gap-2">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Concrete work item" required className="bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent" />
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Acceptance result (optional)" className="bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent" />
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="bg-panel-2 rounded px-3 py-2 text-sm outline-none">
          <option value="">Unscoped</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button type="submit" disabled={busy || !title.trim()} className="text-xs rounded bg-accent/20 text-accent px-4 py-2 hover:bg-accent/30 disabled:opacity-40">Capture</button>
      </form>

      {error && <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <FocusablePanel id="pipeline-board" label="Execution Pipeline · Lifecycle board">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {COLUMNS.map((column) => (
          <div key={column} className="rounded-lg border border-border bg-panel p-3 min-h-[260px] space-y-2">
            <div className="text-xs uppercase tracking-wide flex items-center justify-between">
              <span>{column.replace("-", " ")}</span>
              <span className="text-muted mono">{items.filter((item) => item.stage === column).length}</span>
            </div>
            {items.filter((item) => item.stage === column).map((item) => (
              <div key={item.id} className="rounded border border-border bg-panel-2 p-3 text-xs space-y-2">
                <div className="font-medium">{item.title}</div>
                {item.description && <div className="text-muted">{item.description}</div>}
                <div className="text-[10px] text-accent">{projectName(item.projectId)}</div>
                <div className="flex justify-between">
                  <button type="button" onClick={() => move(item, -1)} disabled={busy || COLUMNS.indexOf(item.stage) === 0} className="rounded bg-panel px-2 py-1 hover:bg-border disabled:opacity-30">←</button>
                  <button type="button" onClick={() => move(item, 1)} disabled={busy || COLUMNS.indexOf(item.stage) === COLUMNS.length - 1} className={`rounded px-2 py-1 disabled:opacity-30 ${item.stage === "human-gate" ? "bg-ok/20 text-ok" : "bg-panel hover:bg-border"}`}>
                    {item.stage === "human-gate" ? "Release →" : "→"}
                  </button>
                </div>
              </div>
            ))}
            {items.every((item) => item.stage !== column) && <div className="text-[11px] text-muted text-center py-5">empty</div>}
          </div>
        ))}
      </div>
      </FocusablePanel>
    </div>
  );
}
