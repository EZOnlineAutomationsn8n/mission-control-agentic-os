"use client";

import { useState } from "react";

// Pipeline board — CAPTURE → HUMAN GATE → EXECUTE → SHIPPED. Local UI
// scaffold only: items live in this tab's memory, clearly labeled as such
// (no persistent DB is wired yet). Creating and moving items works today;
// persistence is the stated next wiring step.

const COLUMNS = ["CAPTURE", "HUMAN GATE", "EXECUTE", "SHIPPED"] as const;
type Column = (typeof COLUMNS)[number];

interface PipelineItem {
  id: string;
  title: string;
  column: Column;
  createdAt: string;
}

export default function PipelinePage() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [title, setTitle] = useState("");

  function addItem(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setItems((prev) => [
      ...prev,
      { id: `${Date.now().toString(36)}-${prev.length}`, title: t, column: "CAPTURE", createdAt: new Date().toISOString() },
    ]);
    setTitle("");
  }

  function move(id: string, dir: -1 | 1) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const idx = COLUMNS.indexOf(it.column) + dir;
        if (idx < 0 || idx >= COLUMNS.length) return it;
        return { ...it, column: COLUMNS[idx] };
      })
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Pipeline</h1>
        <p className="text-sm text-muted mt-1">
          Capture → human gate → execute → shipped. Local scaffold only — items are not persisted yet (next wiring:
          a data store behind <span className="mono">/api/pipeline</span>).
        </p>
      </div>

      <form onSubmit={addItem} className="flex gap-2 max-w-xl">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New work item → lands in CAPTURE"
          className="flex-1 bg-panel-2 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
        <button type="submit" className="text-xs rounded bg-accent/20 text-accent px-4 py-2 hover:bg-accent/30">
          Add
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
        {COLUMNS.map((col) => (
          <div key={col} className="rounded-lg border border-border bg-panel p-3 min-h-[200px] space-y-2">
            <div className="text-xs uppercase tracking-wide flex items-center justify-between">
              <span>{col}</span>
              <span className="text-muted mono">{items.filter((i) => i.column === col).length}</span>
            </div>
            {items
              .filter((i) => i.column === col)
              .map((it) => (
                <div key={it.id} className="rounded border border-border bg-panel-2 p-2 text-xs space-y-1.5">
                  <div>{it.title}</div>
                  <div className="flex justify-between">
                    <button
                      onClick={() => move(it.id, -1)}
                      disabled={COLUMNS.indexOf(it.column) === 0}
                      className="rounded bg-panel px-2 py-0.5 hover:bg-border disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => move(it.id, 1)}
                      disabled={COLUMNS.indexOf(it.column) === COLUMNS.length - 1}
                      className="rounded bg-panel px-2 py-0.5 hover:bg-border disabled:opacity-30"
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            {items.filter((i) => i.column === col).length === 0 && (
              <div className="text-[11px] text-muted text-center py-3">empty</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
