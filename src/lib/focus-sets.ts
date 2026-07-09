// Focus-set definitions for the Operator Home cockpit layout. These are
// pure data — the UI (page.tsx) reads this list and renders whichever set
// is selected through the same generic AgentWindow / CompactOverviewGrid
// components. No per-agent UI branching lives here or downstream of it.

export type FocusSetId = "core-4" | "infra-4" | "compact";

export interface FocusSetDef {
  id: FocusSetId;
  label: string;
  description: string;
  /** Exactly 4 system ids for a 2x2 window layout, or null for the compact overview mode. */
  systemIds: string[] | null;
}

export const FOCUS_SETS: FocusSetDef[] = [
  {
    id: "core-4",
    label: "Core 4",
    description: "FCC / OwlAlpha, Hermes, OpenClaw, Obsidian — Shared Brain",
    systemIds: ["claude-fcc", "hermes", "openclaw", "obsidian"],
  },
  {
    id: "infra-4",
    label: "Infrastructure 4",
    description: "Paperclip, n8n, AGY Orchestrator, Browser Agents",
    systemIds: ["paperclip", "n8n", "agy", "browser-agents"],
  },
  {
    id: "compact",
    label: "All active (compact)",
    description: "Compact status cards for all 8 active systems — not full terminals",
    systemIds: null,
  },
];

export const DEFAULT_FOCUS_SET: FocusSetId = "core-4";
