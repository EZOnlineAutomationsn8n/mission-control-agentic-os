// Local, in-memory, app-side governance action log. Module-level singleton
// (persists for the browser tab's session only) — no external DB, per
// AGENTIC_OS_BUILD_POLICY.md. Any client component can record/read from
// this without prop-drilling across routes (Registry, ControlRoom, etc.).
//
// Every entry recorded here is also durably persisted to the project-local
// audit file (see src/lib/audit-log-store.ts, written only through the
// /api/audit route) so the audit event survives a full page reload, not
// just in-tab navigation. Persistence is best-effort and fire-and-forget:
// a failed persist never blocks or fakes the in-memory/live UI, and is
// itself never silently swallowed — see the console.error below.

export interface ActionLogEntry {
  timestamp: string;
  connectorId: string;
  actionType: string;
  status: string;
  resultSummary: string;
}

const log: ActionLogEntry[] = [];
const listeners = new Set<() => void>();

export function recordAction(entry: ActionLogEntry, options: { persist?: boolean } = {}) {
  log.unshift(entry);
  if (log.length > 200) log.length = 200;
  listeners.forEach((l) => l());
  if (options.persist !== false) void persistAuditEvent(entry);
}

async function persistAuditEvent(entry: ActionLogEntry): Promise<void> {
  if (typeof window === "undefined") return; // never fetch during SSR
  try {
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) {
      console.error("audit persistence failed:", await res.text());
    }
  } catch (e) {
    console.error("audit persistence request failed:", e);
  }
}

export function getRecentActions(connectorId?: string, limit = 20): ActionLogEntry[] {
  const filtered = connectorId ? log.filter((e) => e.connectorId === connectorId) : log;
  return filtered.slice(0, limit);
}

export function getLastAction(connectorId: string): ActionLogEntry | null {
  return log.find((e) => e.connectorId === connectorId) ?? null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
