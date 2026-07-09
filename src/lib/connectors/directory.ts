import { connectorRegistry } from "./registry";
import { futureConnectors } from "@/mocks/future-connectors";
import type { ConnectorCategory, ConnectorSummary } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// CONNECTOR DIRECTORY
// Merges the 8 active adapters (from ConnectorRegistry) with the future/
// pending connector catalog (from mocks/future-connectors.ts) into one
// flat, render-only list. This is the single data source the Sidebar and
// System Registry page use for grouping/search — neither component ever
// branches on a specific connector id, active or future.
// ─────────────────────────────────────────────────────────────────────────

export const CATEGORY_ORDER: ConnectorCategory[] = [
  "AI Agents",
  "Orchestrators",
  "Automation",
  "Browser Agents",
  "Knowledge / Memory",
  "Project Management",
  "Communication",
  "Code / Dev Tools",
  "Databases",
  "File Systems",
  "APIs / Webhooks",
  "Governance / Proof",
  "Monitoring / Logs",
];

export function getConnectorDirectory(): ConnectorSummary[] {
  const active: ConnectorSummary[] = connectorRegistry.list().map((a) => {
    const d = a.descriptor();
    return {
      id: d.id,
      name: d.name,
      category: d.category,
      type: d.type,
      status: d.status,
      isActive: true,
      connectionModes: d.connectionModes,
      capabilities: d.capabilities,
      notes: null,
    };
  });

  const pending: ConnectorSummary[] = futureConnectors.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    type: f.type,
    status: f.status,
    isActive: false,
    connectionModes: f.plannedConnectionModes,
    capabilities: f.capabilities,
    notes: f.notes,
  }));

  return [...active, ...pending];
}

export function groupByCategory(summaries: ConnectorSummary[]): Map<ConnectorCategory, ConnectorSummary[]> {
  const map = new Map<ConnectorCategory, ConnectorSummary[]>();
  for (const cat of CATEGORY_ORDER) map.set(cat, []);
  for (const s of summaries) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }
  return map;
}

export function connectorCounts() {
  const all = getConnectorDirectory();
  return {
    active: all.filter((s) => s.isActive).length,
    pending: all.filter((s) => !s.isActive).length,
    total: all.length,
  };
}
