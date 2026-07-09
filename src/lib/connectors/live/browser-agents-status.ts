import { promises as fs } from "fs";
import type { BrowserAgentsLiveStatus } from "./browser-agents-status-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Must only be imported from a server context (the API route
// below). Never import it from a "use client" component or from
// src/lib/connectors/mock/browser-agents.ts.
//
// Read-only Browser Agents status detection, per
// the read-only detection contract:
//   - never reads .env values, auth files, or secret-bearing config
//   - never reads page content, tab content, or navigation history
//   - never opens a CDP WebSocket, never issues a CDP command — only GETs
//     the standard Chrome DevTools discovery endpoint `/json/version`,
//     which returns non-secret browser/product metadata only
//   - never executes anything, never spawns a subprocess (no `ps`, no
//     `systemctl`, no shelling out) — same fs+fetch-only pattern as the
//     Hermes/FCC/OpenClaw/Obsidian/Paperclip/n8n/AGY readers
//
// No browser automation process was found running on this host during
// recon (no listener on the CDP default port, no chrome/chromium/
// playwright/puppeteer process). The probe below is honest either way:
// if nothing is listening, it truthfully reports "disconnected" rather
// than fabricating a connected state.
// ─────────────────────────────────────────────────────────────────────────

const CDP_VERSION_URL = "http://127.0.0.1:9222/json/version";
const CDP_TIMEOUT_MS = 1500;
// No real per-agent profile path has been configured yet (see
// realConnectionFields.profilePath in the descriptor) — this is checked
// only if/when an operator supplies one via settings. Until then this
// reader does not guess a path.
const PROFILE_PATH: string | null = null;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchCdpVersion(): Promise<
  | { reachable: true; body: { Browser?: unknown; webSocketDebuggerUrl?: unknown } }
  | { reachable: false; error: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CDP_TIMEOUT_MS);
  try {
    const res = await fetch(CDP_VERSION_URL, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { Browser?: unknown; webSocketDebuggerUrl?: unknown };
    return { reachable: true, body };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unreachable";
    return { reachable: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function readBrowserAgentsLiveStatus(): Promise<BrowserAgentsLiveStatus> {
  const errors: string[] = [];

  const cdp = await fetchCdpVersion();
  const cdpReachable = cdp.reachable;
  let cdpVersion: string | null = null;
  let cdpWebSocketDebuggerUrl: string | null = null;

  if (!cdp.reachable) {
    errors.push(`CDP discovery endpoint unreachable at ${CDP_VERSION_URL}: ${cdp.error}`);
  } else {
    cdpVersion = typeof cdp.body.Browser === "string" ? cdp.body.Browser : null;
    cdpWebSocketDebuggerUrl =
      typeof cdp.body.webSocketDebuggerUrl === "string" ? cdp.body.webSocketDebuggerUrl : null;
  }

  const profilePathExists = PROFILE_PATH ? await pathExists(PROFILE_PATH) : false;
  if (!PROFILE_PATH) {
    errors.push("no profile path configured yet (realConnectionFields.profilePath is unset)");
  }

  const status: BrowserAgentsLiveStatus["status"] = cdpReachable ? "connected" : "disconnected";

  return {
    systemId: "browser-agents",
    label: "Browser Agents",
    status,
    mode: "local-cdp-probe",
    source: CDP_VERSION_URL,
    cdpReachable,
    cdpVersion,
    cdpWebSocketDebuggerUrl,
    profilePathExists,
    commandExecution: false,
    outputKind: "live-status",
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}
