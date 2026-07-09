import { promises as fs } from "fs";
import path from "path";
import type { HermesLiveStatus } from "./hermes-status-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. This module uses Node's `fs`/`path` and must only be
// imported from a server context (the API route below). Never import it
// from a "use client" component or from src/lib/connectors/mock/hermes.ts.
//
// Read-only Hermes gateway status detection. Per hard constraints:
//   - never reads .env, auth.json, config.yaml, or any secret-bearing file
//   - never executes the hermes binary or attaches to any process/tmux
//   - never writes, signals, or restarts anything
//   - only inspects: gateway_state.json, gateway.pid, /proc/<pid> existence,
//     and the (non-secret) OpenRouter adapter scaffold contract/report
// ─────────────────────────────────────────────────────────────────────────

const GATEWAY_STATE_PATH = "/root/.hermes/gateway_state.json";
const GATEWAY_PID_PATH = "/root/.hermes/gateway.pid";
const CONTRACT_PATH = "/opt/vireon/workfloor/hermes/contracts/hermes_openrouter_contract.json";
const SCAFFOLD_STATUS_PATH = "/opt/vireon/workfloor/hermes/reports/hermes_scaffold_status.json";

// Known-good facts from the read-only inventory pass. Not re-derived by
// executing the Hermes binary (that would violate "do not invoke the
// interactive Hermes CLI") — these are static, non-secret identifiers.
const KNOWN_VERSION = "Hermes Agent v0.18.0 (2026.7.1)";
const KNOWN_PROVIDER = "openrouter";
const KNOWN_DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

type JsonReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

async function readJsonFile(filePath: string): Promise<JsonReadResult> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    return { ok: true, data };
  } catch {
    return { ok: false, error: `unreadable: ${path.basename(filePath)}` };
  }
}

/** Filesystem-only liveness check — reads /proc, never sends a signal. */
async function isPidAlive(pid: number | null): Promise<boolean> {
  if (pid === null || pid <= 0) return false;
  try {
    await fs.access(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export async function readHermesLiveStatus(): Promise<HermesLiveStatus> {
  const errors: string[] = [];

  const stateResult = await readJsonFile(GATEWAY_STATE_PATH);
  const pidFileResult = await readJsonFile(GATEWAY_PID_PATH);
  const contractResult = await readJsonFile(CONTRACT_PATH);
  const scaffoldResult = await readJsonFile(SCAFFOLD_STATUS_PATH);

  let pid: number | null = null;
  let gatewayState = "unknown";
  let platforms: string[] = [];

  if (stateResult.ok) {
    pid = asNumber(stateResult.data.pid);
    gatewayState = asString(stateResult.data.gateway_state, "unknown");
    const platformsField = stateResult.data.platforms;
    platforms =
      platformsField && typeof platformsField === "object"
        ? Object.keys(platformsField as Record<string, unknown>)
        : [];
  } else {
    errors.push(stateResult.error);
  }

  if (pid === null) {
    if (pidFileResult.ok) {
      pid = asNumber(pidFileResult.data.pid);
    } else {
      errors.push(pidFileResult.error);
    }
  }

  const pidAlive = await isPidAlive(pid);

  let contractStatus = "unknown";
  if (contractResult.ok) {
    contractStatus = asString(contractResult.data.status, "unknown");
  } else if (scaffoldResult.ok) {
    contractStatus = asString(scaffoldResult.data.status, "unknown");
  } else {
    errors.push("integration contract/scaffold status unreadable");
  }

  let status: HermesLiveStatus["status"];
  if (stateResult.ok && pidAlive) {
    status = "connected";
  } else if (stateResult.ok && !pidAlive) {
    status = "degraded";
    errors.push("gateway state file readable but pid is not alive");
  } else {
    status = "disconnected";
  }

  if (contractStatus === "SCAFFOLD_ONLY" && status === "connected") {
    status = "degraded";
    errors.push("integration contract is SCAFFOLD_ONLY — gateway process alive but not fully wired");
  }

  return {
    systemId: "hermes",
    label: "Hermes",
    status,
    mode: "gateway",
    source: "hermes-gateway.service",
    pid,
    pidAlive,
    gatewayState,
    platforms,
    activeAgents: [],
    provider: KNOWN_PROVIDER,
    defaultModel: KNOWN_DEFAULT_MODEL,
    version: KNOWN_VERSION,
    contractStatus,
    commandExecution: false,
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
