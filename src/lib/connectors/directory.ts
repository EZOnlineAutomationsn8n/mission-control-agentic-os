import { connectorRegistry } from "./registry";
import type { ConnectorCategory, ConnectorSummary } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// CONNECTOR DIRECTORY
// Operator-facing inventory of adapters that are actually registered in the
// running system. Future ideas stay in engineering documentation; they do not
// appear as product objects before a connector exists.
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

  return active;
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
