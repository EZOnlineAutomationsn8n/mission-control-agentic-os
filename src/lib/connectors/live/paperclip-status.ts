import { promises as fs } from "fs";
import type { PaperclipLiveStatus } from "./paperclip-status-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Must only be imported from a server context (the API route
// below). Never import it from a "use client" component or from
// src/lib/connectors/mock/paperclip.ts.
//
// Read-only Paperclip status detection, per the read-only detection contract
// (AGENTIC_OS_BUILD_POLICY.md):
//   - never reads .env values, auth files, or secret-bearing config
//   - never reads user content (leads, documents, database rows)
//   - never sends a prompt/command to Paperclip — only GETs its own
//     bootstrap/health endpoint
//   - never executes anything, never spawns a subprocess (no `ps`, no
//     `systemctl`, no shelling out) — same fs+fetch-only pattern as the
//     Hermes/FCC/OpenClaw/Obsidian readers
//
// Paperclip's root `/`, `/health`, and `/status` paths all just serve its
// SPA shell (checked during recon) — the only genuine JSON status endpoint
// is `/api/health`, which returns non-secret bootstrap/deployment metadata
// only (no user/document content).
// ─────────────────────────────────────────────────────────────────────────

const HEALTH_URL = "http://127.0.0.1:3100/api/health";
const HEALTH_TIMEOUT_MS = 2000;
const EXPECTED_CMDLINE_MARKERS = ["paperclipai", "--instance"];

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

/**
 * Pure filesystem process-existence check: scans /proc/<pid>/cmdline for
 * the expected Paperclip runtime command shape. Reads public argv only
 * (never env/secret content) and never spawns a subprocess.
 */
async function findPaperclipPid(): Promise<number | null> {
  let entries: string[];
  try {
    entries = await fs.readdir("/proc");
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const raw = await fs.readFile(`/proc/${entry}/cmdline`, "utf8");
      const joined = raw.split("\0").filter(Boolean).join(" ");
      if (EXPECTED_CMDLINE_MARKERS.every((marker) => joined.includes(marker))) {
        return Number(entry);
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function readPaperclipLiveStatus(): Promise<PaperclipLiveStatus> {
  const errors: string[] = [];

  const health = await fetchHealth();
  const pid = await findPaperclipPid();
  const pidAlive = pid !== null;
  if (!pidAlive) {
    errors.push("no process matching the expected Paperclip runtime command shape was found");
  }

  let status: PaperclipLiveStatus["status"];
  let httpStatus: number | null = null;
  let bootstrapStatus: string | null = null;
  let deploymentMode: string | null = null;

  if (!health.reachable) {
    status = pidAlive ? "degraded" : "disconnected";
    errors.push(`health endpoint unreachable: ${health.error}`);
  } else {
    httpStatus = health.httpStatus;
    const body = health.body as { status?: unknown; bootstrapStatus?: unknown; deploymentMode?: unknown } | null;
    const bodyStatus = body && typeof body.status === "string" ? body.status.toLowerCase() : null;
    bootstrapStatus = body && typeof body.bootstrapStatus === "string" ? body.bootstrapStatus : null;
    deploymentMode = body && typeof body.deploymentMode === "string" ? body.deploymentMode : null;

    const httpOk = health.httpStatus >= 200 && health.httpStatus < 300;
    if (httpOk && bodyStatus === "ok" && pidAlive) {
      status = "connected";
    } else if (httpOk || pidAlive) {
      status = "degraded";
      if (!httpOk) errors.push(`health endpoint returned HTTP ${health.httpStatus}`);
      if (httpOk && bodyStatus !== "ok") errors.push(`health endpoint reachable but returned unexpected body: ${JSON.stringify(body)}`);
    } else {
      status = "disconnected";
    }
  }

  return {
    systemId: "paperclip",
    label: "Paperclip",
    status,
    mode: "local-http-health",
    source: "127.0.0.1:3100/api/health",
    healthReachable: health.reachable,
    httpStatus,
    bootstrapStatus,
    deploymentMode,
    pidAlive,
    commandExecution: false,
    outputKind: "live-status",
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
