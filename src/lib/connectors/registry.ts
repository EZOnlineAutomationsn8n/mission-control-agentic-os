import type { AgentSystemAdapter } from "./types";
import { claudeFccAdapter } from "./mock/claude-fcc";
import { hermesAdapter } from "./mock/hermes";
import { openClawAdapter } from "./mock/openclaw";
import { paperclipAdapter } from "./mock/paperclip";
import { n8nAdapter } from "./mock/n8n";
import { agyAdapter } from "./mock/agy";
import { obsidianAdapter } from "./mock/obsidian";
import { browserAgentsAdapter } from "./mock/browser-agents";

// ─────────────────────────────────────────────────────────────────────────
// CONNECTOR REGISTRY
// The single source of truth for every system attached to the Agentic OS.
// The sidebar, Operator Home, and every control room render FROM this list.
// To add a new agent system: write one adapter module (implementing
// AgentSystemAdapter) + its mock data, then register it here. Nothing else
// in the UI layer changes.
// ─────────────────────────────────────────────────────────────────────────

class ConnectorRegistry {
  private adapters = new Map<string, AgentSystemAdapter>();

  constructor(initial: AgentSystemAdapter[]) {
    for (const adapter of initial) {
      this.adapters.set(adapter.descriptor().id, adapter);
    }
  }

  register(adapter: AgentSystemAdapter) {
    this.adapters.set(adapter.descriptor().id, adapter);
  }

  list(): AgentSystemAdapter[] {
    return Array.from(this.adapters.values());
  }

  get(id: string): AgentSystemAdapter | undefined {
    return this.adapters.get(id);
  }

  ids(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export const connectorRegistry = new ConnectorRegistry([
  claudeFccAdapter,
  hermesAdapter,
  openClawAdapter,
  paperclipAdapter,
  n8nAdapter,
  agyAdapter,
  obsidianAdapter,
  browserAgentsAdapter,
]);

export { obsidianAdapter };
