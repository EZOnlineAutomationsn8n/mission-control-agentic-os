import { promises as fs } from "fs";
import type { FccLiveStatus } from "./fcc-status-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Must only be imported from a server context (the API route
// below). Never import it from a "use client" component or from
// src/lib/connectors/mock/claude-fcc.ts.
//
// Read-only FCC (free-claude-code) status detection. Per hard constraints:
//   - never reads .env values, API keys, or auth files
//   - never sends a prompt/command to FCC — only GETs its health endpoint
//   - never executes anything, never attaches to any process/tmux
//   - only inspects: the local health endpoint, and file presence under
//     /opt/vireon/workfloor/fcc/free-claude-code
//
// Important correction carried through this module: FCC is NOT "Sonnet".
// free-claude-code is a provider-agnostic proxy — its real runtime lane
// here is a coding-first OpenRouter free-model lane, not Anthropic Sonnet.
// ─────────────────────────────────────────────────────────────────────────

const HEALTH_URL = "http://127.0.0.1:8082/health";
const HEALTH_TIMEOUT_MS = 2000;
const SERVER_FILE_PATH = "/opt/vireon/workfloor/fcc/free-claude-code/server.py";

const KNOWN_SERVICE = "free-claude-code";
const KNOWN_PROVIDER = "openrouter";
const KNOWN_MODEL_ROUTE = "coding-first free-route chain (9 routes, #1 Laguna M.1)";

async function serverFileExists(): Promise<boolean> {
  try {
    await fs.access(SERVER_FILE_PATH);
    return true;
  } catch {
    return false;
  }
}

async function fetchHealth(): Promise<
  | { reachable: true; httpStatus: number; body: unknown }
  | { reachable: false; httpStatus: number | null; error: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal, cache: "no-store" });
    const httpStatus = res.status;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON body — still reachable, just can't parse it
    }
    return { reachable: true, httpStatus, body };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unreachable";
    return { reachable: false, httpStatus: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function readFccLiveStatus(): Promise<FccLiveStatus> {
  const errors: string[] = [];

  const health = await fetchHealth();
  const filePresent = await serverFileExists();
  if (!filePresent) {
    errors.push(`server file not found: ${SERVER_FILE_PATH}`);
  }

  let status: FccLiveStatus["status"];
  let httpStatus: number | null = null;

  if (!health.reachable) {
    status = "disconnected";
    errors.push(`health endpoint unreachable: ${health.error}`);
  } else {
    httpStatus = health.httpStatus;
    const body = health.body as { status?: unknown } | null;
    const bodyStatus = body && typeof body.status === "string" ? body.status.toLowerCase() : null;

    if (health.httpStatus >= 200 && health.httpStatus < 300 && bodyStatus === "healthy") {
      status = "connected";
    } else if (health.httpStatus >= 200 && health.httpStatus < 300) {
      status = "degraded";
      errors.push(`health endpoint reachable but returned unexpected body: ${JSON.stringify(body)}`);
    } else {
      status = "degraded";
      errors.push(`health endpoint returned HTTP ${health.httpStatus}`);
    }
  }

  return {
    systemId: "claude-fcc",
    label: "FCC Model Gateway",
    status,
    mode: "local-http-health",
    source: "127.0.0.1:8082/health",
    healthReachable: health.reachable,
    httpStatus,
    service: KNOWN_SERVICE,
    provider: KNOWN_PROVIDER,
    modelRoute: KNOWN_MODEL_ROUTE,
    commandExecution: false,
    outputKind: "live-status",
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
