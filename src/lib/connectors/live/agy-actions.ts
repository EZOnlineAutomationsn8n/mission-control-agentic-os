import type { AgyContextResult } from "./agy-actions-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. AGY projectContext action — a safe, explicit, read-only GET
// against AGY's own /status endpoint (fleet registry snapshot: agent
// count, pending count, registry health). This is NOT job orchestration:
// no task is routed, no agent is paused/resumed, nothing is dispatched.
// True orchestration/job-trigger stays blocked (see agy.ts capabilities)
// because no safe job-dispatch endpoint was discovered on this host.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_URL = "http://127.0.0.1:8090/status";
const REQUEST_TIMEOUT_MS = 3000;

export async function fetchAgyProjectContext(): Promise<AgyContextResult> {
  const timestamp = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(STATUS_URL, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      return { status: "failed", text: null, error: `AGY /status returned HTTP ${res.status}`, timestamp };
    }
    const body = (await res.json().catch(() => null)) as {
      registry?: unknown;
      agents_total?: unknown;
      pending?: unknown;
    } | null;
    if (!body) {
      return { status: "failed", text: null, error: "AGY /status returned no parsable body", timestamp };
    }
    const text = `registry: ${body.registry ?? "unknown"} · agents: ${body.agents_total ?? "unknown"} · pending: ${body.pending ?? "unknown"}`;
    return { status: "completed", text, error: null, timestamp };
  } catch (e) {
    return { status: "failed", text: null, error: e instanceof Error ? e.message : "request failed", timestamp };
  } finally {
    clearTimeout(timer);
  }
}
