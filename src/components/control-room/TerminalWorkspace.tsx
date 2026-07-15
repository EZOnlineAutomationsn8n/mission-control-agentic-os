"use client";

import { useEffect, useState } from "react";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { AgentSystemState } from "@/lib/connectors/types";
import { statusColor, dotGlowStyle } from "@/lib/ui-helpers";
import { AgentConversationPanel } from "./AgentConversationPanel";

const STORAGE_KEY = "mission-control-terminal-slots-v2";
const ACTIVE_SLOT_KEY = "mission-control-active-terminal-v1";
const DEFAULT_SLOTS = ["claude-fcc", "hermes", "agy", "openclaw"] as const;
const TERMINAL_TARGETS = [
  { id: "claude-fcc", label: "Claude Code" },
  { id: "hermes", label: "Hermes" },
  { id: "agy", label: "Antigravity" },
  { id: "openclaw", label: "OpenClaw" },
  { id: "gemini", label: "Gemini" },
  { id: "codex", label: "Codex" },
] as const;

function blockerText(state: AgentSystemState): string {
  const blocked = state.capabilities.find((capability) => capability.kind === "blocked" || !capability.available);
  return blocked?.reason ?? "No operator messaging endpoint is wired for this system.";
}

function TerminalSurface({ systemId }: { systemId: string }) {
  const adapter = connectorRegistry.get(systemId);
  const [state, setState] = useState<AgentSystemState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!adapter) return;
      const next = await adapter.getState();
      if (!cancelled) setState(next);
    }
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [adapter, systemId]);

  if (systemId === "gemini") {
    return <AgentConversationPanel agentId="gemini" endpoint="/api/connectors/gemini/actions/ask" label="Gemini" terminal />;
  }
  if (systemId === "codex") {
    return <AgentConversationPanel agentId="codex" endpoint="/api/connectors/codex/actions/ask" label="Codex" terminal />;
  }
  if (!adapter) return <div className="h-full p-4 mono text-xs text-danger">Unknown terminal target: {systemId}</div>;
  if (!state) return <div className="h-full p-4 mono text-xs text-muted">Connecting terminal…</div>;

  if (state.controlledAction?.id === "claude-code-agent") {
    return <AgentConversationPanel agentId="claude-code" endpoint={state.controlledAction.endpoint} label="Claude Code" terminal />;
  }
  if (systemId === "hermes") {
    return <AgentConversationPanel agentId="hermes" endpoint="/api/connectors/hermes/actions/ask" label="Hermes" terminal />;
  }
  if (systemId === "openclaw") {
    return <AgentConversationPanel agentId="openclaw" endpoint="/api/connectors/openclaw/actions/ask" label="OpenClaw" terminal />;
  }
  if (systemId === "agy") {
    return <AgentConversationPanel agentId="agy" endpoint="/api/connectors/agy/actions/ask" label="Antigravity" terminal />;
  }

  const descriptor = adapter.descriptor();
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#070a0d]">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 mono text-xs leading-6">
        <div className="text-muted">[{new Date().toLocaleTimeString()}] {descriptor.name}</div>
        <div className={state.status === "connected" ? "text-ok" : "text-warn"}>status: {state.status} · {state.runState}</div>
        <div className="mt-4 text-foreground/90">No messaging bridge available.</div>
        <div className="text-warn">{blockerText(state)}</div>
        <div className="mt-4 text-muted">Select another agent for this slot or wire this agent&apos;s real session endpoint.</div>
      </div>
      <div className="border-t border-border p-3 text-xs text-muted">Input unavailable until a real agent message route is connected.</div>
    </div>
  );
}

export function TerminalWorkspace() {
  const [slots, setSlots] = useState<string[]>([...DEFAULT_SLOTS]);
  const [activeSlot, setActiveSlot] = useState(0);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let nextActiveSlot = 0;
      const storedActiveSlot = Number(window.localStorage.getItem(ACTIVE_SLOT_KEY));
      if (Number.isInteger(storedActiveSlot) && storedActiveSlot >= 0 && storedActiveSlot < 4) {
        nextActiveSlot = storedActiveSlot;
        setActiveSlot(storedActiveSlot);
      }

      let nextSlots: string[] = [...DEFAULT_SLOTS];
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (
            Array.isArray(parsed) &&
            parsed.length === 4 &&
            parsed.every((value) => typeof value === "string" && TERMINAL_TARGETS.some((target) => target.id === value))
          ) nextSlots = parsed;
        } catch {
          // Ignore invalid local operator layout and keep safe defaults.
        }
      }

      const requested = new URLSearchParams(window.location.search).get("agent");
      if (requested && TERMINAL_TARGETS.some((target) => target.id === requested)) {
        nextSlots = nextSlots.map((value, index) => index === nextActiveSlot ? requested : value);
        window.history.replaceState({}, "", window.location.pathname);
      }
      setSlots(nextSlots);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function selectAgent(event: Event) {
      const systemId = (event as CustomEvent<string>).detail;
      if (!TERMINAL_TARGETS.some((target) => target.id === systemId)) return;
      setSlots((current) => current.map((value, index) => index === activeSlot ? systemId : value));
    }
    window.addEventListener("mission-control:select-agent", selectAgent);
    return () => window.removeEventListener("mission-control:select-agent", selectAgent);
  }, [activeSlot]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  }, [slots]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_SLOT_KEY, String(activeSlot));
  }, [activeSlot]);

  function assign(slotIndex: number, systemId: string) {
    setSlots((current) => current.map((value, index) => index === slotIndex ? systemId : value));
    setActiveSlot(slotIndex);
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {slots.map((systemId, slotIndex) => {
        const target = TERMINAL_TARGETS.find((entry) => entry.id === systemId) ?? TERMINAL_TARGETS[0];
        const adapter = connectorRegistry.get(systemId);
        const descriptor = adapter?.descriptor();
        return (
          <section
            key={slotIndex}
            onMouseDown={() => setActiveSlot(slotIndex)}
            className={'rounded-xl border overflow-hidden h-[calc(100dvh-12rem)] min-h-[48rem] max-h-[72rem] flex flex-col bg-panel ' + (activeSlot === slotIndex ? "border-accent shadow-[0_0_20px_rgba(0,229,255,0.12)]" : "border-border")}
          >
            <header className="h-11 px-3 border-b border-border bg-panel-2 flex items-center gap-3 shrink-0">
              <span className="text-[10px] text-muted mono">TERMINAL {slotIndex + 1}</span>
              <span className="status-dot shrink-0" style={dotGlowStyle(statusColor(descriptor?.status ?? "disconnected"))} />
              <select value={target.id} onChange={(event) => assign(slotIndex, event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" aria-label={'Agent for terminal ' + (slotIndex + 1)}>
                {TERMINAL_TARGETS.map((entry) => <option key={entry.id} value={entry.id} className="bg-panel text-foreground">{entry.label}</option>)}
              </select>
              {activeSlot === slotIndex && <span className="text-[9px] uppercase tracking-wide text-accent">active</span>}
            </header>
            <div className="flex-1 min-h-0"><TerminalSurface systemId={systemId} /></div>
          </section>
        );
      })}
    </div>
  );
}
