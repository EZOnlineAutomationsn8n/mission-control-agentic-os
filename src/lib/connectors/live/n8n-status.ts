import type { N8nLiveStatus } from "./n8n-status-types";

// SERVER-ONLY. GET-only health check against n8n's own /healthz endpoint.
// No workflow trigger, no credential read, no shell/file/service action.
const HEALTH_URL = "http://127.0.0.1:5678/healthz";
const HEALTH_TIMEOUT_MS = 2000;

export async function readN8nLiveStatus(): Promise<N8nLiveStatus> {
  const errors: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  let status: N8nLiveStatus["status"] = "disconnected";
  let httpStatus: number | null = null;
  let healthReachable = false;

  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal, cache: "no-store" });
    httpStatus = res.status;
    healthReachable = res.ok;
    if (res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // ignore
      }
      const bodyOk = body && typeof (body as { status?: unknown }).status === "string";
      status = bodyOk ? "connected" : "degraded";
      if (!bodyOk) errors.push(`health endpoint reachable but returned unexpected body`);
    } else {
      status = "degraded";
      errors.push(`health endpoint returned HTTP ${res.status}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unreachable";
    errors.push(`health endpoint unreachable: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  return {
    systemId: "n8n",
    label: "n8n",
    status,
    mode: "local-http-health",
    source: "127.0.0.1:5678/healthz",
    healthReachable,
    httpStatus,
    commandExecution: false,
    outputKind: "live-status",
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
