"use client";

import { useCallback, useEffect, useState } from "react";
import type { OperatorProject } from "@/lib/operator-work";
import { FocusablePanel } from "@/components/shell/PanelFocus";

export function ProjectLayer() {
  const [projects, setProjects] = useState<OperatorProject[]>([]);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const body = await response.json() as { projects?: OperatorProject[]; error?: string };
    if (!response.ok) throw new Error(body.error || `Project read failed (${response.status})`);
    setProjects(body.projects ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial read from the persistent projects API
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Project read failed"));
  }, [refresh]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, summary, workspacePath }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `Project create failed (${response.status})`);
      setName("");
      setSummary("");
      setWorkspacePath("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Projects</h1>
        <p className="text-sm text-muted mt-1">
          Persistent operator projects. Nothing is seeded: only projects created here are shown.
        </p>
      </div>

      <FocusablePanel id="projects-compose" label="Projects · Create project" className="max-w-3xl">
      <form onSubmit={createProject} className="rounded-lg border border-border bg-panel p-4 space-y-3 h-full">
        <div className="text-sm font-medium">Create project</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" required className="bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent" />
          <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="Workspace path (optional)" className="bg-panel-2 rounded px-3 py-2 text-sm mono outline-none focus:ring-1 focus:ring-accent" />
        </div>
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Purpose and current objective" rows={2} className="w-full resize-none bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent" />
        <button type="submit" disabled={saving || !name.trim()} className="text-xs rounded bg-accent/20 text-accent px-4 py-2 hover:bg-accent/30 disabled:opacity-40">
          {saving ? "Creating…" : "Create project"}
        </button>
      </form>
      </FocusablePanel>

      {error && <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <FocusablePanel id="projects-list" label="Projects · Project workspaces">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {projects.map((project) => (
          <div key={project.id} className="rounded-lg border border-border bg-panel p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium">{project.name}</h2>
              <span className="rounded bg-ok/15 px-2 py-0.5 text-[10px] uppercase text-ok">{project.status}</span>
            </div>
            <p className="text-sm text-muted">{project.summary || "No summary recorded."}</p>
            {project.workspacePath && <div className="text-xs mono text-accent break-all">{project.workspacePath}</div>}
            <div className="text-[10px] text-muted mono">{project.id}</div>
          </div>
        ))}
        {projects.length === 0 && (
          <div className="rounded-lg border border-border bg-panel p-8 text-center text-sm text-muted">
            No operator projects recorded yet.
          </div>
        )}
      </div>
      </FocusablePanel>
    </div>
  );
}
