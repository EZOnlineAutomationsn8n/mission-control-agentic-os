"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusablePanel, PanelFocusButton } from "@/components/shell/PanelFocus";

// Interactive knowledge graph of the Obsidian vault projection (read-only).
// Canvas + a small force simulation, no external graph library.

interface GNode { id: string; title: string; folder: string; degree: number; bytes: number }
interface GLink { source: string; target: string }
interface GraphPayload {
  root: string; bindingKind: string; fingerprint: string | null; generatedAt: string | null; scannedAt: string;
  nodes: GNode[]; links: GLink[]; folders: string[]; unresolvedLinks: number;
}
interface SimNode extends GNode { x: number; y: number; vx: number; vy: number; fixed: boolean; r: number; color: string; i: number }

const PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#c084fc", "#4ade80", "#f59e0b", "#60a5fa", "#e879f9", "#2dd4bf", "#facc15", "#93c5fd"];

function renderNoteText(content: string) {
  const parts: React.ReactNode[] = [];
  const re = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(content))) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    const target = m[1].trim();
    parts.push(<button key={k++} type="button" className="mc-graph-wikilink" data-target={target}>{m[2] ?? target}</button>);
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts;
}

export function KnowledgeGraph() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hiddenFolders, setHiddenFolders] = useState<Set<string>>(new Set());
  const [localOnly, setLocalOnly] = useState(false);
  const [note, setNote] = useState<{ id: string; content: string; truncated: boolean } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<{ nodes: SimNode[]; byId: Map<string, SimNode>; links: [SimNode, SimNode][]; adj: Map<string, Set<string>>; alpha: number } | null>(null);
  const viewRef = useRef({ x: 0, y: 0, k: 0.6 });
  const dragRef = useRef<{ mode: "pan" | "node" | null; node?: SimNode; sx: number; sy: number; moved: boolean }>({ mode: null, sx: 0, sy: 0, moved: false });
  const frameRef = useRef<number | null>(null);
  const stateRef = useRef({ selected, hovered, query, hiddenFolders, localOnly });
  useEffect(() => {
    stateRef.current = { selected, hovered, query, hiddenFolders, localOnly };
  }, [selected, hovered, query, hiddenFolders, localOnly]);

  const load = useCallback(async (refresh = false) => {
    try {
      const response = await fetch(`/api/brain/graph${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? `HTTP ${response.status}`); return; }
      setData(body as GraphPayload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "graph load failed");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load of the external vault graph
    void load();
  }, [load]);

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const l of data?.links ?? []) {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source)!.add(l.target); adj.get(l.target)!.add(l.source);
    }
    return adj;
  }, [data]);

  const folderColor = useMemo(() => {
    const map = new Map<string, string>();
    (data?.folders ?? []).forEach((folder, index) => map.set(folder, PALETTE[index % PALETTE.length]));
    return map;
  }, [data]);

  // Build simulation when data arrives.
  useEffect(() => {
    if (!data) return;
    const folderIndex = new Map(data.folders.map((f, i) => [f, i]));
    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const fi = folderIndex.get(n.folder) ?? 0;
      const angle = (fi / Math.max(1, data.folders.length)) * Math.PI * 2;
      const spread = 260 + Math.random() * 220;
      return { ...n, i, x: Math.cos(angle) * spread + (Math.random() - 0.5) * 120, y: Math.sin(angle) * spread + (Math.random() - 0.5) * 120, vx: 0, vy: 0, fixed: false, r: 3 + Math.min(14, Math.sqrt(n.degree) * 2.2), color: folderColor.get(n.folder) ?? "#94a3b8" };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: [SimNode, SimNode][] = [];
    const adj = new Map<string, Set<string>>();
    for (const l of data.links) {
      const a = byId.get(l.source); const b = byId.get(l.target);
      if (!a || !b) continue;
      links.push([a, b]);
      if (!adj.has(a.id)) adj.set(a.id, new Set());
      if (!adj.has(b.id)) adj.set(b.id, new Set());
      adj.get(a.id)!.add(b.id); adj.get(b.id)!.add(a.id);
    }
    simRef.current = { nodes, byId, links, adj, alpha: 1 };
    const wrap = wrapRef.current;
    if (wrap) viewRef.current = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2, k: 0.55 };
  }, [data, folderColor]);

  const visible = useCallback((n: SimNode) => {
    const s = stateRef.current;
    if (s.hiddenFolders.has(n.folder)) return false;
    if (s.localOnly && s.selected) {
      if (n.id === s.selected) return true;
      const sim = simRef.current;
      return Boolean(sim?.adj.get(s.selected)?.has(n.id));
    }
    return true;
  }, []);

  // Simulation + render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const step = () => {
      const sim = simRef.current;
      if (sim && sim.alpha > 0.005) {
        const { nodes, links } = sim;
        const alpha = sim.alpha;
        // repulsion with a coarse grid
        const cell = 90;
        const grid = new Map<string, SimNode[]>();
        for (const n of nodes) {
          const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
          const list = grid.get(key); if (list) list.push(n); else grid.set(key, [n]);
        }
        for (const n of nodes) {
          const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const list = grid.get(`${gx + dx},${gy + dy}`); if (!list) continue;
            for (const o of list) {
              if (o === n) continue;
              let ddx = n.x - o.x, ddy = n.y - o.y;
              let d2 = ddx * ddx + ddy * ddy;
              if (d2 < 0.01) { ddx = Math.random() - 0.5; ddy = Math.random() - 0.5; d2 = 0.25; }
              if (d2 > cell * cell) continue;
              const f = (1400 * alpha) / d2;
              n.vx += ddx * f; n.vy += ddy * f;
            }
          }
          // weak global centering
          n.vx -= n.x * 0.0025 * alpha; n.vy -= n.y * 0.0025 * alpha;
        }
        for (const [a, b] of links) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = ((d - 70) / d) * 0.05 * alpha;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
        for (const n of nodes) {
          if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
          n.vx *= 0.82; n.vy *= 0.82;
          n.x += Math.max(-20, Math.min(20, n.vx)); n.y += Math.max(-20, Math.min(20, n.vy));
        }
        sim.alpha *= 0.992;
      }
      draw();
      frameRef.current = requestAnimationFrame(step);
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const sim = simRef.current; if (!sim) return;
      const v = viewRef.current; const s = stateRef.current;
      const q = s.query.trim().toLowerCase();
      const focus = s.hovered ?? s.selected;
      const neighbours = focus ? sim.adj.get(focus) : undefined;
      ctx.save(); ctx.translate(v.x, v.y); ctx.scale(v.k, v.k);
      ctx.lineWidth = 0.6 / v.k;
      for (const [a, b] of sim.links) {
        if (!visible(a) || !visible(b)) continue;
        const hot = focus && (a.id === focus || b.id === focus);
        ctx.strokeStyle = hot ? "rgba(250,204,21,0.85)" : focus ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.16)";
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const n of sim.nodes) {
        if (!visible(n)) continue;
        const match = q && (n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
        const dim = (focus && n.id !== focus && !neighbours?.has(n.id)) || (q && !match);
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.fillStyle = n.color;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        if (n.id === s.selected || match) {
          ctx.lineWidth = 2 / v.k; ctx.strokeStyle = "#fde68a"; ctx.stroke(); ctx.lineWidth = 0.6 / v.k;
        }
        const showLabel = n.id === focus || n.id === s.selected || (neighbours?.has(n.id) && (neighbours.size <= 30 || v.k > 1.4)) || match || v.k > 1.4 || (v.k > 0.8 && n.degree > 8);
        if (showLabel && !dim) {
          ctx.globalAlpha = 1;
          ctx.font = `${12 / v.k}px ui-sans-serif, system-ui`;
          ctx.fillStyle = "rgba(226,232,240,0.95)";
          ctx.fillText(n.title, n.x + n.r + 3 / v.k, n.y + 4 / v.k);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [visible]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  };
  const hit = (clientX: number, clientY: number): SimNode | null => {
    const sim = simRef.current; if (!sim) return null;
    const p = toWorld(clientX, clientY);
    let best: SimNode | null = null; let bestD = Infinity;
    for (const n of sim.nodes) {
      if (!visible(n)) continue;
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      const r = Math.max(n.r, 6 / viewRef.current.k);
      if (d < r * r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  const openNote = useCallback(async (id: string) => {
    setSelected(id);
    setNote(null);
    try {
      const response = await fetch(`/api/brain/note?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (response.ok) setNote(await response.json());
    } catch { /* side panel stays empty */ }
  }, []);

  const centerOn = (id: string) => {
    const n = simRef.current?.byId.get(id); const wrap = wrapRef.current;
    if (!n || !wrap) return;
    const k = Math.max(viewRef.current.k, 1.2);
    viewRef.current = { k, x: wrap.clientWidth / 2 - n.x * k, y: wrap.clientHeight / 2 - n.y * k };
  };

  const followLink = (target: string) => {
    const sim = simRef.current; if (!sim) return;
    const lower = target.toLowerCase();
    const node = sim.nodes.find((n) => n.id.toLowerCase() === lower) ?? sim.nodes.find((n) => n.title.toLowerCase() === lower.split("/").pop());
    if (node) { centerOn(node.id); void openNote(node.id); }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(6, Math.max(0.08, v.k * factor));
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    viewRef.current = { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const n = hit(e.clientX, e.clientY);
    dragRef.current = n ? { mode: "node", node: n, sx: e.clientX, sy: e.clientY, moved: false } : { mode: "pan", sx: e.clientX, sy: e.clientY, moved: false };
    if (n) n.fixed = true;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.mode) {
      const n = hit(e.clientX, e.clientY);
      setHovered(n?.id ?? null);
      canvasRef.current!.style.cursor = n ? "pointer" : "grab";
      return;
    }
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.mode === "pan") {
      viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
      d.sx = e.clientX; d.sy = e.clientY;
    } else if (d.node) {
      const p = toWorld(e.clientX, e.clientY);
      d.node.x = p.x; d.node.y = p.y;
      if (simRef.current) simRef.current.alpha = Math.max(simRef.current.alpha, 0.15);
    }
  };
  const onUp = () => {
    const d = dragRef.current;
    if (d.mode === "node" && d.node) {
      d.node.fixed = false;
      if (!d.moved) void openNote(d.node.id);
    } else if (d.mode === "pan" && !d.moved) {
      setSelected(null); setNote(null);
    }
    dragRef.current = { mode: null, sx: 0, sy: 0, moved: false };
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    return data.nodes.filter((n) => n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).slice(0, 8);
  }, [query, data]);

  const selectedNode = selected ? data?.nodes.find((n) => n.id === selected) ?? null : null;
  const selectedNeighbours = selected ? [...(adjacency.get(selected) ?? [])] : [];

  return (
    <FocusablePanel id="knowledge-graph" label="Kennisgraaf" className="mc-graph-panel" inlineControls>
      <section className="mc-graph">
        <header className="mc-graph-head">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Kennisgraaf · Obsidian</div>
            <div className="text-[11px] text-muted truncate">
              {data ? `${data.nodes.length} notities · ${data.links.length} verbindingen · ${data.bindingKind === "derived-readonly-projection" ? "alleen-lezen projectie" : "alleen-lezen vault"}${data.generatedAt ? ` van ${new Date(data.generatedAt).toLocaleString()}` : ""}` : error ?? "laden…"}
            </div>
          </div>
          <div className="mc-graph-search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zoek notitie…" className="mc-apps-input" />
            {matches.length > 0 && (
              <div className="mc-graph-results">
                {matches.map((n) => (
                  <button key={n.id} type="button" onClick={() => { centerOn(n.id); void openNote(n.id); setQuery(""); }}>
                    <span className="mc-graph-dot" style={{ background: folderColor.get(n.folder) }} />{n.title}<span className="text-muted ml-auto text-[10px]">{n.folder}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className={"mc-button mc-button-sm " + (localOnly ? "mc-button-primary" : "mc-button-secondary")} disabled={!selected} onClick={() => setLocalOnly((v) => !v)}>Alleen buren</button>
          <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => { if (simRef.current) simRef.current.alpha = 0.6; }}>Herschikken</button>
          <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => void load(true)}>Vernieuwen</button>
          <PanelFocusButton />
        </header>
        <div className="mc-graph-folders">
          {(data?.folders ?? []).map((folder) => (
            <button key={folder} type="button" onClick={() => setHiddenFolders((prev) => { const next = new Set(prev); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; })}
              className={"mc-graph-folder " + (hiddenFolders.has(folder) ? "mc-graph-folder-off" : "")}>
              <span className="mc-graph-dot" style={{ background: folderColor.get(folder) }} />{folder}
            </button>
          ))}
        </div>
        <div className="mc-graph-body">
          <div ref={wrapRef} className="mc-graph-canvas-wrap">
            <canvas ref={canvasRef} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHovered(null)} />
            {error && <div className="mc-apps-empty">{error}</div>}
          </div>
          {selectedNode && (
            <aside className="mc-graph-note">
              <div className="flex items-center gap-2">
                <span className="mc-graph-dot" style={{ background: folderColor.get(selectedNode.folder) }} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{selectedNode.title}</div>
                  <div className="mono text-[10px] text-muted truncate">{selectedNode.id}.md</div>
                </div>
                <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => { setSelected(null); setNote(null); setLocalOnly(false); }}>Sluiten</button>
              </div>
              <div className="mt-2 text-[11px] text-muted">{selectedNeighbours.length} verbonden notities</div>
              <div className="mc-graph-neighbours">
                {selectedNeighbours.slice(0, 40).map((id) => (
                  <button key={id} type="button" className="mc-graph-wikilink" onClick={() => { centerOn(id); void openNote(id); }}>{id.split("/").pop()}</button>
                ))}
              </div>
              <div className="mc-graph-note-body" onClick={(event) => { const target = (event.target as HTMLElement).dataset.target; if (target) followLink(target); }}>
                {note ? renderNoteText(note.content) : "laden…"}
                {note?.truncated && <div className="text-muted mt-2">(ingekort)</div>}
              </div>
            </aside>
          )}
        </div>
      </section>
    </FocusablePanel>
  );
}
