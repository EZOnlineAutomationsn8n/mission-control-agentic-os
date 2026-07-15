import type { AgyLiveStatus } from "./agy-status-types";

// SERVER-ONLY. GET-only checks against AGY's own /health and /status
// endpoints. /status was confirmed during recon to be a safe read-only
// fleet registry snapshot ({service, status, registry, agents_total,
// pending, time}) — no secrets, no job dispatch. No task routing, no
// shell/file/service action anywhere in this module.
const HEALTH_URL = process.env.AGY_HEALTH_URL || "http://127.0.0.1:8090/health";
const STATUS_URL = process.env.AGY_STATUS_URL || "http://127.0.0.1:8090/status";
const REQUEST_TIMEOUT_MS = 2000;

async function getJson(url: string): Promise<{ ok: boolean; httpStatus: number | null; body: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, httpStatus: res.status, body };
  } catch (e) {
    return { ok: false, httpStatus: null, body: null, error: e instanceof Error ? e.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function readAgyLiveStatus(): Promise<AgyLiveStatus> {
  const errors: string[] = [];

  const health = await getJson(HEALTH_URL);
  const httpStatus: number | null = health.httpStatus;
  const healthReachable = health.ok;
  let service: string | null = null;
  let status: AgyLiveStatus["status"] = "disconnected";

  if (health.ok) {
    const body = health.body as { status?: unknown; service?: unknown } | null;
    const bodyOk = body && body.status === "ok";
    service = body && typeof body.service === "string" ? body.service : null;
    status = bodyOk ? "connected" : "degraded";
    if (!bodyOk) errors.push("health endpoint reachable but returned unexpected body");
  } else {
    status = "degraded";
    errors.push(health.error ? `health endpoint unreachable: ${health.error}` : `health endpoint returned HTTP ${health.httpStatus}`);
  }

  const statusRes = await getJson(STATUS_URL);
  let registryOk: boolean | null = null;
  let agentsTotal: number | null = null;
  let pending: number | null = null;

  if (statusRes.ok) {
    const body = statusRes.body as { registry?: unknown; agents_total?: unknown; pending?: unknown } | null;
    registryOk = body?.registry === "ok";
    agentsTotal = typeof body?.agents_total === "number" ? body.agents_total : null;
    pending = typeof body?.pending === "number" ? body.pending : null;
  } else {
    errors.push("registry snapshot endpoint (/status) unreachable — project context unavailable");
  }

  return {
    systemId: "agy",
    label: "Antigravity",
    status,
    mode: "local-http-health",
    source: HEALTH_URL,
    healthReachable,
    httpStatus,
    service,
    registryOk,
    agentsTotal,
    pending,
    commandExecution: false,
    outputKind: "live-status",
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
