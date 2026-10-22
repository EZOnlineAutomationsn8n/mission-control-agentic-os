import { promises as fs } from "fs";
import type { OpenClawLiveStatus } from "./openclaw-status-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Must only be imported from a server context (the API route
// below). Never import it from a "use client" component or from
// src/lib/connectors/mock/openclaw.ts.
//
// Read-only OpenClaw gateway status detection. Per hard constraints:
//   - never starts, restarts, or signals OpenClaw in any way
//   - never attaches to any OpenClaw session (old main session or otherwise)
//   - never sends a prompt/command to OpenClaw
//   - never enables/queries/reactivates the heartbeat loop
//   - never reads .env values, auth files, or openclaw.json (which holds
//     session/identity state) — only a local HTTP GET to the gateway's own
//     /health endpoint, and a pure filesystem scan of /proc/<pid>/cmdline
//     (public process argv, not session content) to confirm the expected
//     gateway process is running. No subprocess is ever spawned by this
//     reader (no `ps`, no `systemctl`, no shelling out) — matching the
//     same fs+fetch-only pattern used by the Hermes and FCC readers.
// ─────────────────────────────────────────────────────────────────────────

const HEALTH_URL = process.env.OPENCLAW_HEALTH_URL || "http://127.0.0.1:18789/health";
const HEALTH_TIMEOUT_MS = 2000;
const REQUIRE_LOCAL_PROCESS = process.env.OPENCLAW_REQUIRE_LOCAL_PROCESS !== "0";

const KNOWN_SERVICE = "openclaw-gateway.service";
const EXPECTED_CMDLINE_MARKERS = ["openclaw", "gateway", "18789"];

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
 * the expected OpenClaw gateway command shape. This reads public argv only
 * (never session/env/secret content) and never spawns a subprocess — it is
 * the fs-based equivalent of `pgrep -f`, not a command execution.
 */
async function findGatewayPid(): Promise<number | null> {
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
      // process may have exited between readdir and readFile, or the
      // cmdline is unreadable (permissions) — skip and keep scanning
      continue;
    }
  }
  return null;
}

export async function readOpenClawLiveStatus(): Promise<OpenClawLiveStatus> {
  const errors: string[] = [];

  const health = await fetchHealth();
  const pid = REQUIRE_LOCAL_PROCESS ? await findGatewayPid() : null;
  const pidAlive = REQUIRE_LOCAL_PROCESS ? pid !== null : null;

  let httpStatus: number | null = null;
  let gatewayReachable = false;

  if (!health.reachable) {
    errors.push(`gateway endpoint unreachable: ${health.error}`);
  } else {
    gatewayReachable = health.httpStatus >= 200 && health.httpStatus < 300;
    httpStatus = health.httpStatus;
    const body = health.body as { ok?: unknown; status?: unknown } | null;
    const bodyHealthy = body && (body.ok === true || body.status === "live" || body.status === "ok");
    if (gatewayReachable && !bodyHealthy) {
      errors.push(`health endpoint reachable but returned unexpected body: ${JSON.stringify(body)}`);
    }
    if (!gatewayReachable) {
      errors.push(`health endpoint returned HTTP ${health.httpStatus}`);
    }
  }

  if (REQUIRE_LOCAL_PROCESS && !pidAlive) {
    errors.push("OpenClaw process not visible in this PID namespace; host process status unverified");
  }

  let status: OpenClawLiveStatus["status"];
  const healthBody = health.reachable ? (health.body as { ok?: unknown; status?: unknown } | null) : null;
  const verifiedHealthy = health.reachable && gatewayReachable
    && Boolean(healthBody && (healthBody.ok === true || healthBody.status === "live" || healthBody.status === "ok"));
  if (verifiedHealthy && (pidAlive || !REQUIRE_LOCAL_PROCESS)) {
    status = "connected";
  } else if (pidAlive || gatewayReachable) {
    status = "degraded";
  } else {
    // Container-local loopback and a missing host relay cannot prove host shutdown.
    status = "unknown";
    errors.push("Host gateway reachability is unverified from this container network namespace");
  }

  return {
    systemId: "openclaw",
    label: "OpenClaw",
    status,
    mode: REQUIRE_LOCAL_PROCESS ? "local-gateway-status" : "remote-gateway-status",
    source: HEALTH_URL,
    service: KNOWN_SERVICE,
    gatewayReachable,
    httpStatus,
    pidAlive,
    commandExecution: false,
    outputKind: "live-status",
    // Static declarative values — see type comments. This reader never
    // probes or touches either of these; they are reported as a standing
    // operational fact, not a live-derived signal.
    heartbeat: "disabled",
    oldMainSession: "untouched",
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
