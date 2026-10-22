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
// System/connector integration registry: authoritative for registered adapters
// and their health/capability surfaces. Cockpit agent discovery and pane/session
// binding are intentionally separate in src/lib/cockpit/agent-registry.ts.
// Registering an adapter here must not hard-bind that system to a cockpit pane.
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
